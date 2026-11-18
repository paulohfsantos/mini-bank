# Riscos previstos de segurança e performance: mini-banco

Análise feita **antes da implementação**, sobre o design descrito em `README.md`, `plan.md` e `aws.md`. Cada risco tem um ID (`SEC-xx`, `PERF-xx`) para ser referenciado em specs, ADRs, testes e PRs, como os critérios de aceite.

Severidade: **Alta** (perda de dinheiro, vazamento ou indisponibilidade provável), **Média** (degradação ou exposição limitada), **Baixa** (higiene). A coluna "Lab" diz se o risco é aceito como débito no laboratório.

---

## 1. Os 12 que mudam o design (resolver antes ou durante a fase em que aparecem)

> **Status:** todos os 12 já foram incorporados ao design em `README.md`, `plan.md` (tarefas e ACs com o ID do risco) e `aws.md`, e as ADRs 0006, 0016, 0019 e 0021 registram as decisões. Os demais itens também estão distribuídos pelas fases do `plan.md`.

| # | ID | Problema | Mudança proposta |
|---|---|---|---|
| 1 | SEC-01 | O site público no Amplify permite que **qualquer pessoa na internet** crie contas com saldo e transfira dinheiro de qualquer conta | Proteção por senha do branch no Amplify (basic auth) + ambiente só ligado durante a sessão |
| 2 | SEC-02 | Amplify → ALB em HTTP: a `x-api-key` trafega em texto claro pela internet | CloudFront na frente do ALB (certificado `*.cloudfront.net` gratuito), header secreto de origem e SG do ALB restrito ao prefix list de origem do CloudFront |
| 3 | SEC-05 | `POST /v1/accounts` com saldo inicial livre é uma "impressora de dinheiro" | Limite máximo de saldo inicial na spec (`ACC-BR-03`) e registro como débito consciente |
| 4 | SEC-14 | Um evento `transfer.completed` falso na fila seria processado como verdade | O worker confirma a transferência no banco (`SELECT` por `transferId`) antes de agir |
| 5 | SEC-20 | `sslmode=require` criptografa, mas **não valida o certificado** do RDS | `sslmode=verify-full` com o CA bundle do RDS embutido na imagem |
| 6 | PERF-01 | O Node fecha conexões keep-alive em 5 s e o ALB as mantém por 60 s, o que gera **502 intermitentes** | `server.keepAliveTimeout = 65s` e `headersTimeout = 66s` |
| 7 | PERF-04 | O relay do outbox chama o SQS **dentro da transação** que segura os locks `SKIP LOCKED`; um SQS lento prende conexões | Padrão "claim": `UPDATE ... SET claimed_until = now() + 30s ... RETURNING`, commit, envio fora da transação e depois `published_at` |
| 8 | PERF-06 | Sem `lock_timeout`, requisições numa conta "quente" empilham esperando lock e esgotam o pool | `SET LOCAL lock_timeout = '2s'` e `statement_timeout`; responder 503 com `Retry-After` |
| 9 | PERF-09 | `pg` devolve `bigint` → se convertido para `BigInt`, `JSON.stringify` **lança erro** | Converter na borda com `Number.isSafeInteger` (e validar teto de valor no contrato); `BigInt` só dentro do `Money` |
| 10 | PERF-11 | A regra `HIGH_VELOCITY` faz `count` por origem e janela de tempo sem índice | Índice `transfers (source_account_id, created_at)`; janela relativa ao `completedAt` do evento, **não a `now()`** |
| 11 | PERF-14 | Paginação por `created_at`: uma transação que começa antes e commita depois insere uma linha "no passado", que o leitor já paginou | Reescrever `STM-AC-05`: a garantia vale para lançamentos commitados antes da primeira página; documentar o porquê |
| 12 | PERF-15 | Migrations com `ALTER TABLE` / `CREATE INDEX` travam tabelas durante o deploy | `lock_timeout` nas migrations, `CREATE INDEX CONCURRENTLY` (dbmate `transaction:false`), padrão expand/contract |

---

## 2. Segurança

### 2.1 Autenticação, autorização e lógica de negócio

| ID | Risco | Cenário concreto | Sev. | Lab | Mitigação | Fase |
|---|---|---|---|---|---|---|
| SEC-01 | Front público sem login | Qualquer visitante da URL do Amplify transfere dinheiro de qualquer conta (o servidor Next sempre envia a API key) | Alta | Mitigar | Senha do branch no Amplify; ambiente efêmero; em produção, OIDC + autorização por titular | 6 |
| SEC-03 | BOLA (OWASP API1) | Com a API key, `GET /v1/accounts/{id}` de qualquer conta funciona; `sourceAccountId` não é checado contra o chamador | Alta | Débito | Documentado na ADR-0012; em produção: o `sub` do token deve ser dono da conta de origem | 1 |
| SEC-04 | Enumeração de CPF | `409 DOCUMENT_ALREADY_REGISTERED` revela se um CPF é cliente (questão de LGPD) | Média | Débito | Em produção só com usuário autenticado; aqui, registrar na spec | 1 |
| SEC-05 | Criação de dinheiro | `initialBalanceCents` arbitrário | Média | Mitigar | Teto (ex.: R$ 100.000) em `ACC-BR-03`; em produção o saldo vem de depósito no ledger | 1 |
| SEC-06 | Overflow / precisão | `amountCents = 9007199254740993` perde precisão em `number`; soma estoura | Alta | Mitigar | Zod `.int().positive().max(LIMITE)`; teto no `openapi.yaml`; `CHECK` no banco | 1–2 |
| SEC-07 | Antifraude é pós-fato | Transferência `FLAGGED` já foi concluída e o dinheiro já saiu | Média | Aceito | Explicar: monitoramento transacional ≠ bloqueio preventivo; em produção haveria regras síncronas antes do débito | 3 |
| SEC-08 | Comparação de API key não constante | Timing attack descobre a key byte a byte | Baixa | Mitigar | `crypto.timingSafeEqual` sobre hashes de tamanho fixo | 2 |

### 2.2 Entrada, API e idempotência

| ID | Risco | Cenário concreto | Sev. | Lab | Mitigação | Fase |
|---|---|---|---|---|---|---|
| SEC-09 | SQL injection (SQL puro) | Template string interpolada em `query()`; `ORDER BY`/colunas dinâmicas | Alta | Mitigar | Só parâmetros `$n`; regra de lint; nada dinâmico fora de whitelist; teste com payloads clássicos | 2 |
| SEC-10 | `Idempotency-Key` sem limites | Chave de 1 MB ou bilhões de chaves distintas enchem a tabela | Média | Mitigar | Formato UUID ou ≤ 64 chars; job de limpeza por `expires_at`; rate limit | 2 |
| SEC-11 | Escopo da chave de idempotência | Com vários clientes, A reusaria a chave de B e receberia a resposta de B | Média | Já tratado | PK `(client_id, key)`; em produção, por principal autenticado | 2 |
| SEC-12 | `x-correlation-id` do cliente sem validação | Valor gigante ou com quebras de linha polui logs e dispara cardinalidade | Baixa | Mitigar | Aceitar só UUID/≤ 64 chars `[A-Za-z0-9-]`; senão gerar novo | 2 |
| SEC-13 | Vazamento por erro | Mensagem do Postgres (nome de constraint, SQL) ou stack trace no `problem+json` | Média | Mitigar | Filtro global mapeia erros conhecidos; o resto vira 500 genérico + `correlationId` | 2 |
| SEC-15 | Body e campos sem limite | JSON de 50 MB, `holderName` de 1 MB, caracteres de controle | Média | Mitigar | Limite de body (ex.: 16 KB), `maxLength`, `additionalProperties: false`, normalização Unicode (NFC) | 2 |
| SEC-16 | Cursor forjado | Base64 manipulado com `created_at` absurdo ou SQL | Baixa | Mitigar | Decodificar com zod estrito; cursor só posiciona, nunca autoriza | 2 |
| SEC-17 | Swagger e health expostos | `/docs` público revela o contrato; `/health/ready` revela versões e hosts | Baixa | Mitigar | `/docs` desligado no `lab` AWS (ou protegido); health devolve só `status` | 5 |
| SEC-18 | Rate limit ineficaz | Atrás do ALB, sem `trust proxy` o IP é sempre o do ALB; atrás do Amplify, todo usuário vem dos mesmos IPs | Média | Mitigar | `trust proxy` com número exato de hops; limite por API key + global; em produção, WAF rate-based rules | 10 |
| SEC-19 | CORS aberto | `enableCors()` padrão permitiria chamadas do browser à API | Baixa | Mitigar | Sem CORS: o browser nunca fala com a API | 2 |

### 2.3 Assíncrono e dados

| ID | Risco | Cenário concreto | Sev. | Lab | Mitigação | Fase |
|---|---|---|---|---|---|---|
| SEC-14 | Evento forjado ou corrompido | Alguém com `sqs:SendMessage` (ou um bug) publica um `transfer.completed` inexistente | Média | Mitigar | Worker valida no schema **e** confirma no banco; queue policy sem `Principal: *` | 3 |
| SEC-21 | PII espalhada | CPF em logs, no evento, na DLQ (14 dias) ou em fixtures | Média | Mitigar | Evento só com IDs; redaction do pino (`document`, `x-api-key`, `authorization`); CPFs de teste gerados (válidos, mas falsos) | 2–3 |
| SEC-22 | Redrive de mensagem velha | DLQ reprocessada dias depois reavalia fraude com contexto atual | Baixa | Aceito | Regras usam o timestamp do evento; consumer idempotente | 3 |
| SEC-23 | LGPD vs ledger imutável | Pedido de exclusão de dados × lançamentos que não podem sumir | Baixa | Débito | Explicar: pseudonimização do titular; retenção legal prevalece | 10 |

### 2.4 Front-end (Next.js)

| ID | Risco | Cenário concreto | Sev. | Lab | Mitigação | Fase |
|---|---|---|---|---|---|---|
| SEC-24 | Server Actions são endpoints POST públicos | Atacante chama a action direto, sem passar pela validação do formulário | Alta | Mitigar | Revalidar com zod **dentro** da action; nunca confiar em campo hidden (exceto a idempotency key, que é só deduplicação) | 4 |
| SEC-25 | Segredo vazando para o client | `API_KEY` importada num Client Component ou com prefixo `NEXT_PUBLIC_` | Alta | Mitigar | `import 'server-only'` no módulo do client HTTP; teste que procura a key no bundle `.next/static` | 4 |
| SEC-26 | CVEs do Next.js/React | Houve CVEs críticos recentes (ex.: CVE-2025-29927, bypass de middleware; CVE-2025-55182, RCE em React Server Components) | Alta | Mitigar | Versões corrigidas fixadas, Dependabot, **não usar middleware como única barreira de autorização** | 0, 10 |
| SEC-27 | Headers ausentes | Clickjacking, sniffing de MIME, referrer vazando IDs de conta na URL | Baixa | Mitigar | CSP, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `X-Content-Type-Options` | 10 |
| SEC-28 | API key no Amplify | Env var visível no console e potencialmente escrita em `.env.production` no artefato de build | Média | Débito | Restringir acesso ao console; avaliar ler do Secrets Manager com a compute role SSR do Amplify (conferir disponibilidade) | 6 |

### 2.5 AWS, rede e IAM

| ID | Risco | Cenário concreto | Sev. | Lab | Mitigação | Fase |
|---|---|---|---|---|---|---|
| SEC-02 | Tráfego sem TLS até o ALB | Key e dados em claro na internet | Alta | Mitigar | CloudFront + header de origem, ou domínio + ACM | 6 |
| SEC-20 | TLS ao RDS sem validação | MITM teórico dentro da VPC | Baixa | Mitigar | `verify-full` + CA bundle; `rds.force_ssl = 1` no parameter group | 6 |
| SEC-29 | Tasks com IP público | Um SG errado expõe a porta 3001 direto; egress `0.0.0.0/0:443` permite exfiltração se comprometido | Média | Débito | `sg-worker` sem ingress, `sg-api` só do ALB; checkov no CI; em produção, subnets privadas + egress filtrado | 6 |
| SEC-30 | CI comprometido = banco comprometido | A role do CI pode registrar uma nova revisão de `mini-banco-lab-migrate` com comando arbitrário e a role que lê a senha master | Média | Aceito | Environment `lab` com aprovação e restrito à `main`; o CI já implanta código, então é fronteira de confiança. Explicar em entrevista | 7 |
| SEC-31 | Trust policy OIDC frouxa | `sub` com curinga (`repo:*/mini-banco:*`) deixa forks ou outros branches assumirem a role | Alta | Já tratado | `sub` exato com `environment:lab`; teste negativo na fase 7 | 7 |
| SEC-32 | Supply chain | Actions comprometidas (caso `tj-actions/changed-files`, 2025), worms npm (caso Shai-Hulud, 2025), `postinstall` malicioso | Alta | Mitigar | Actions fixadas por **SHA**; pnpm com lifecycle scripts bloqueados exceto whitelist; lockfile congelado; Dependabot com cooldown | 0, 7 |
| SEC-33 | Segredos no Terraform state | `random_password` do app user em texto no state | Média | Mitigar | Bucket privado e criptografado, versionado, acesso só do admin; state local do bootstrap fora do git | 6 |
| SEC-34 | ECS Exec = shell em produção | Quem tem `ecs:ExecuteCommand` lê env vars com segredos | Média | Mitigar | Desligado por padrão (`enable_execute_command = false`); sessões auditadas no CloudTrail | 6 |
| SEC-35 | Container privilegiado | Processo como root, filesystem gravável | Baixa | Mitigar | `USER node`, `readonlyRootFilesystem`, imagem slim/distroless | 10 |
| SEC-36 | Denial of wallet | Bots batendo na URL pública geram requisições SSR, logs e tráfego | Média | Mitigar | Budget + Anomaly Detection, senha no Amplify, rate limit, retenção de logs de 3 dias, nada ligado fora da sessão | 6 |

---

## 3. Performance e resiliência

### 3.1 Banco de dados e concorrência

| ID | Risco | Cenário concreto | Sev. | Mitigação | Fase |
|---|---|---|---|---|---|
| PERF-02 | Pool vs `max_connections` | O `db.t4g.micro` aceita ~80–110 conexões (fórmula `LEAST({DBInstanceClassMemory/9531392}, 5000)`; conferir com `SHOW max_connections`). api + relay + worker + migration + escala podem estourar | Alta | Pool pequeno por processo (ex.: 10 api, 5 worker); `connectionTimeoutMillis`; métrica de espera no pool; orçamento de conexões documentado | 2, 6 |
| PERF-03 | Conta "quente" | Todas as transferências de uma conta serializam no lock da linha; a latência cresce linearmente com a concorrência | Média | Aceito (é a garantia de correção); medir p95/p99 com teste de carga; explicar alternativas (sharding de saldo, filas por conta) | 2 |
| PERF-06 | Espera de lock sem limite | Fila de transações bloqueadas segura conexões até o pool esgotar → toda a API trava | Alta | `lock_timeout = 2s`, `statement_timeout = 5s`, `idle_in_transaction_session_timeout = 10s` | 2 |
| PERF-07 | Mesma idempotency key em rajada | 100 requisições iguais e simultâneas: 99 esperam no índice único, cada uma segurando uma conexão | Média | `lock_timeout` na espera → 409 `REQUEST_IN_PROGRESS` com `Retry-After`; rate limit por key | 2 |
| PERF-08 | Deadlock | Lock em ordens diferentes (idempotência → contas) | Média | Ordem fixa: `idempotency_keys` → contas por `id` crescente; teste com A→B e B→A paralelos | 2 |
| PERF-10 | UUID v4 como PK | Inserções aleatórias no B-tree causam page splits e cache ruim conforme a tabela cresce | Baixa | **UUIDv7** gerado na aplicação (ordenado por tempo) | 2 |
| PERF-11 | Índices faltando | Velocity rule (`source_account_id, created_at`); FKs sem índice (o Postgres não cria automaticamente) | Média | Índices explícitos na migration; `EXPLAIN ANALYZE` nos testes de integração das queries críticas | 2 |
| PERF-12 | Bloat do outbox e da idempotência | `UPDATE published_at` gera tuplas mortas; tabelas crescem sem fim | Média | Job de limpeza (apagar publicados > 7 dias, chaves expiradas); índice parcial `WHERE published_at IS NULL`; acompanhar autovacuum | 3 |
| PERF-13 | CPU burstable do RDS | `t4g` consome créditos de CPU; sob carga contínua. O RDS usa modo **Unlimited** por padrão em T3/T4g (conferir), o que vira custo extra em vez de throttling | Média | Alarme de `CPUCreditBalance` / `CPUSurplusCreditsCharged`; teste de carga curto | 8 |
| PERF-14 | Gap de visibilidade no keyset | `now()` é o início da transação; commits fora de ordem inserem linhas "no passado" | Baixa | Ajustar `STM-AC-05`; o outbox não sofre disso porque usa `published_at IS NULL`, não cursor (bom ponto de entrevista) | 1 |
| PERF-15 | Migration travando produção | `ALTER TABLE ... ADD COLUMN ... DEFAULT` volátil ou `CREATE INDEX` pega lock exclusivo | Alta | `SET lock_timeout` em toda migration; `CONCURRENTLY`; expand/contract; migration roda antes do deploy e é retrocompatível | 2, 7 |

### 3.2 Mensageria

| ID | Risco | Cenário concreto | Sev. | Mitigação | Fase |
|---|---|---|---|---|---|
| PERF-04 | Rede dentro da transação do relay | `SendMessageBatch` lento (ou timeout padrão longo do SDK) segura o lock e a conexão | Alta | Claim com `claimed_until`, envio fora da transação; timeout curto no SDK (ex.: 3 s) | 3 |
| PERF-16 | Latência do polling | Até ~1 s entre commit e publicação; N tasks = N pollers | Baixa | Aceito; opcional `LISTEN/NOTIFY` para acordar o relay | 3 |
| PERF-17 | Worker sequencial | Um poller processando uma mensagem por vez limita a vazão | Média | Processar o lote de 10 com concorrência limitada (ex.: `p-limit(5)`), sempre abaixo do pool do banco | 3 |
| PERF-18 | Visibility timeout vs processamento | Processamento + backoff > 30 s → a mensagem reaparece enquanto ainda está sendo processada → trabalho duplicado | Média | Timeout ≥ 6× o p99 de processamento; heartbeat com `ChangeMessageVisibility` em tarefas longas | 3 |
| PERF-19 | Shutdown lento do worker | Long polling de 20 s + SIGTERM → o ECS mata a task após `stopTimeout` (30 s padrão) no meio do lote | Média | `AbortController` no `ReceiveMessage`; terminar o lote em andamento; `stopTimeout` adequado | 3 |
| PERF-20 | Regra de velocidade com backlog | Se a janela usar `now()`, um backlog de 1 h faz a regra olhar o período errado | Média | Janela `[completedAt - 10min, completedAt]` vinda do evento | 3 |

### 3.3 Runtime, rede e deploy

| ID | Risco | Cenário concreto | Sev. | Mitigação | Fase |
|---|---|---|---|---|---|
| PERF-01 | Keep-alive Node < ALB | 502 esporádicos sem erro no log da app | Alta | `keepAliveTimeout` 65 s, `headersTimeout` 66 s (maiores que o idle timeout do ALB) | 2 |
| PERF-05 | 0,25 vCPU + OTel | Auto-instrumentação completa deixa o startup lento; health check falha antes do app subir → loop de restart | Média | Só as instrumentações usadas (`http`, `pg`, `aws-sdk`, nest); `healthCheckGracePeriodSeconds` 60 s; medir startup | 5, 6 |
| PERF-21 | Memória em 1 GB compartilhado | O Node não respeita o limite do container → OOM kill; o sidecar ADOT também consome memória | Média | `--max-old-space-size` (~60% da memória do container da app); `memory_limiter` no ADOT; limites por container na task def | 6 |
| PERF-22 | Deploy com 1 task | Rolling sem capacidade extra derruba requisições; sem graceful shutdown, requisições em voo morrem | Média | `minimumHealthyPercent = 100`, `maximumPercent = 200`; `enableShutdownHooks()`; deregistration delay 10 s; parar o relay antes de fechar o pool | 6–7 |
| PERF-23 | SSR do Amplify | Cold starts e waterfalls de `fetch` em Server Components | Baixa | `Promise.all` para fetches independentes; `no-store` só no saldo e no extrato | 4 |
| PERF-24 | Logs excessivos | Log de body inteiro em toda requisição → custo de ingestão e PII | Média | Uma linha por requisição (método, rota, status, duração, `correlationId`); `debug` desligado na AWS; pino assíncrono, sem `pino-pretty` em produção | 2 |
| PERF-25 | Cardinalidade de métricas | Dimensão `accountId` ou `transferId` no EMF cria uma métrica cobrada por valor | Média | Dimensões só de baixa cardinalidade (`rule`, `reason`, `service`) | 5, 8 |
| PERF-26 | Testes lentos | Um Testcontainers por arquivo de teste → CI de 10+ min | Baixa | Um container por execução; um banco por worker do Jest via `CREATE DATABASE ... TEMPLATE`; truncate entre testes | 2 |

---

## 4. Como isso entra no fluxo SDD

- Riscos que viram **regra ou critério** entram na spec da feature (ex.: `SEC-05` → `ACC-BR-03`; `PERF-07` → `TRF-AC-13` "rajada com a mesma chave → 409 com `Retry-After`").
- Riscos que viram **decisão** ganham ADR (ex.: `PERF-04` → ADR do claim no outbox; `SEC-02` → ADR do CloudFront na frente do ALB).
- Riscos **aceitos como débito** ficam neste arquivo com a justificativa e aparecem no `README.md` §3.4.
- Cada mitigação implementada tem teste que cita o ID (`it('[PERF-08] A→B e B→A paralelos não geram deadlock', ...)`).
- A fase 10 revisa este documento inteiro e marca o status de cada item.
