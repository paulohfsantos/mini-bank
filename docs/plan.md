# Plano de implementação: mini-banco

Fases pequenas e verificáveis. Uma fase só começa quando o **critério de pronto** da anterior for demonstrado.

## Ajustes em relação às fases sugeridas

- **Logs estruturados e `correlationId` entram na fase 2, não na 5.** O `correlationId` faz parte do schema do evento (fase 1) e da tabela `outbox` (fase 3); adicioná-lo depois exigiria retrabalho em contrato e migration. A fase 5 fica com tracing, métricas e health checks.
- **A fase 6 separa `infra/bootstrap` (persistente) de `infra/envs/lab` (efêmero).** O state bucket, o provider OIDC, o ECR e o Budgets precisam sobreviver ao `terraform destroy` diário, senão cada sessão começaria do zero, sem imagens nem alerta de custo.
- **A fase 7 (CI) começa parcialmente na fase 0**: lint e testes rodam no GitHub Actions desde o primeiro commit. Só o deploy espera a fase 7.
- **As mitigações de [`risks.md`](./risks.md) estão distribuídas pelas fases** (marcadas com o ID `SEC-xx`/`PERF-xx`), em vez de concentradas na fase 10. Corrigir depois sairia mais caro: o claim do outbox, os timeouts de lock e o TLS mudam o design. A fase 10 revisa o documento inteiro.

Convenções usadas em todas as fases:

- IDs de critérios de aceite: `ACC-AC-xx` (contas), `TRF-AC-xx` (transferências), `STM-AC-xx` (extrato), `OBX-AC-xx` (outbox), `PRC-AC-xx` (processamento no worker).
- "Pronto" sempre inclui `pnpm lint && pnpm typecheck && pnpm test` verdes e `CLAUDE.md`/docs atualizados quando algo mudou.

---

## Fase 0: Fundação

**Objetivo:** repositório pronto para trabalhar com SDD e IA, com qualidade automatizada desde o primeiro commit.

**Tarefas**
- [x] `git init`, `.gitignore`, `.editorconfig`, `.nvmrc` (Node 26)
- [x] `pnpm-workspace.yaml` com `apps/*` e `packages/*` e catálogo de versões (TypeScript fixado em 6.0.x: o typescript-eslint ainda não suporta TS 7)
- [x] `packages/config`: `tsconfig.base.json` (`strict: true`, `noUncheckedIndexedAccess`), ESLint 10 (flat config, regras com informação de tipo, `no-explicit-any` em todo o código), Prettier
- [x] Esqueletos vazios: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/observability`, `packages/database`
- [x] Jest na raiz com `@swc/jest` (decorators legados + metadata para o Nest). *Substituído por Vitest + `unplugin-swc` no início da fase 2 (ADR-0023).*
- [x] `docker-compose.yml`: `postgres:17.12-alpine` (healthcheck), `softwaremill/elasticmq-native:1.7.1` (SQS em :9324; LocalStack passou a exigir auth token, ADR-0022), `jaegertracing/jaeger:2.23.0` (v2; 16686, OTLP 4317/4318)
- [x] `infra/local/elasticmq.conf`: cria `mini-banco-transfer-events-dlq` e `mini-banco-transfer-events` com DLQ `maxReceiveCount=5`, visibility 30 s, long polling 20 s
- [x] `scripts/check-local-infra.sh` (`pnpm infra:check`): verifica Postgres, filas, redrive policy e Jaeger usando só curl
- [x] Husky + lint-staged + commitlint (Conventional Commits)
- [x] Supply chain (`SEC-32`): `allowBuilds` com whitelist explícita, `minimumReleaseAge` de 1 dia, `pnpm install --frozen-lockfile` no CI, Dependabot com cooldown
- [x] `CLAUDE.md` na raiz (arquitetura, comandos, fluxo SDD, convenções, regras para IA, checklist de revisão humana, regra "riscos `SEC`/`PERF` citados nos testes")
- [x] ADRs 0001 a 0022 (lista em `README.md` §10) em `docs/adr/`, mais `0000-template.md`
- [x] `.github/workflows/ci.yml`: install com cache do pnpm, lint, format, typecheck, test; **todas as actions fixadas por SHA** de commit, não por tag (`SEC-32`); `permissions:` mínimas
- [x] Template de PR com seções "Specs/ACs afetados" e "Precisa de revisão humana"

**Entregáveis:** monorepo instalável, `docker compose up` saudável, `CLAUDE.md`, ADRs, CI verde.

**Critério de pronto**
- Clonar, rodar `pnpm install && docker compose up -d` e ver os três containers `healthy`.
- `pnpm infra:check` mostra Postgres pronto, fila e DLQ criadas e a redrive policy apontando para a DLQ.
- PR de exemplo dispara o CI e ele passa.

**Prepara para responder:** por que monorepo? Como você estrutura um repositório para trabalhar com IA? O que é uma ADR e quando escrever uma?

---

## Fase 1: Specs e contratos

**Objetivo:** especificar todo o comportamento antes do código, com ACs testáveis e IDs estáveis.

**Tarefas**

> Os critérios de aceite completos vivem em `specs/` (fonte de verdade). Esta lista só acompanha o andamento.

- [x] `specs/README.md`: convenções de IDs (`-BR-`, `-AC-`, `-NFR-`), formato `### ID: título` + `- Nível:`, ciclo de mudança
- [x] `specs/accounts/spec.md`: `ACC-BR-01..08`, `ACC-AC-01..10` (acrescentados `ACC-AC-09` nome normalizado e `ACC-AC-10` CPF mascarado; nova regra `ACC-BR-06`: respostas nunca trazem o CPF completo, `SEC-21`)
- [x] `specs/transfers/spec.md`: `TRF-BR-01..15`, `TRF-AC-01..19`, `TRF-NFR-01..04` (acrescentados `TRF-AC-17` GET, `TRF-AC-18` falha não consome a chave, `TRF-AC-19` evento no outbox; decisão `TRF-BR-11`: só respostas 201 são armazenadas para replay)
- [x] `specs/statement/spec.md`: `STM-BR-01..07`, `STM-AC-01..06` (acrescentado `STM-AC-06` contraparte e tipos)
- [x] `specs/transfer-processing/spec.md`: `OBX-BR-01..04`, `PRC-BR-01..10`, `OBX-AC-01..05`, `PRC-AC-01..08`
- [x] `specs/openapi.yaml` (OpenAPI 3.1): 7 operações, erros `application/problem+json` (RFC 9457) com `code` em enum, `securitySchemes.apiKey`, `Idempotency-Key`, `Retry-After`, exemplos em toda resposta 2xx e nos erros principais
- [x] `specs/events/transfer.completed.v1.schema.json` (JSON Schema 2020-12): envelope aberto a campos novos (consumidor tolerante), exemplo embutido
- [x] `.spectral.yaml`: `spectral:oas` + regras próprias (erros em problem+json, `*Cents` inteiros, request bodies fechados, 2xx com exemplo), cada uma verificada com um contrato propositalmente errado
- [x] `packages/contracts`: zod (v4) para requests, responses e evento; tipos gerados com `openapi-typescript` (`pnpm contracts:generate`, drift checado por `pnpm contracts:check`); `contract-alignment.ts` compara em tempo de compilação os tipos do zod com os gerados
- [x] Testes de contrato: todo exemplo do `openapi.yaml` valida no ajv e no zod; tabela diferencial ajv × zod com as divergências intencionais listadas (dígito verificador do CPF, trim do nome); evento validado por JSON Schema e zod, incluindo tolerância a campos novos
- [x] `pnpm specs:coverage`: lista ACs por spec com níveis esperados × encontrados (unitário/integração/e2e pelo caminho do teste); falha com ID inexistente; `--require=PREFIXOS` torna a cobertura obrigatória
- [x] CI: passo `pnpm specs:check` (Spectral + drift dos tipos + cobertura)

**Entregáveis:** 4 specs, `openapi.yaml`, schema do evento, `packages/contracts` com 122 testes.

**Critério de pronto**
- Spectral passa ✅. Swagger UI servindo o `openapi.yaml` chega com a API na fase 2 (`/docs`).
- `pnpm specs:coverage` lista os 48 ACs; 7 já têm o nível unitário (schemas), o resto "sem teste", como esperado ✅.
- Saber explicar cada AC e por que ele existe.

**Prepara para responder:** o que é SDD na prática? Contract-first vs code-first? Como versionar eventos? Como garantir que o código não diverge do contrato?

---

## Fase 2: API de contas e transferências

**Objetivo:** API síncrona correta sob concorrência, com testes nos três níveis.

**Tarefas**
- [x] Migração para ESM + build com SWC + Vitest, exigida pelo NestJS 12 (só ESM), mantendo imports sem extensão (ADR-0023)
- [x] `packages/observability`: logger pino (JSON, assíncrono, sem `pino-pretty` fora do local), `CorrelationIdMiddleware` (`x-correlation-id` validado ou UUID novo) com `AsyncLocalStorage`, redaction de `document`, `x-api-key` e `authorization`; uma linha de log por requisição, sem body (`PERF-24`, `SEC-21`)
- [x] `db/migrations/0001_initial.sql` (dbmate) com todas as tabelas de `README.md` §3.3, `CHECK`s, FKs e índices (incluindo `transfers (source_account_id, created_at)` e `destination_account_id`; `PERF-11`); `db/schema.sql` gerado e versionado
- [x] Regras de migration no `CLAUDE.md` e num checklist de PR (`PERF-15`): `SET lock_timeout = '3s'` no topo, `CREATE INDEX CONCURRENTLY` com `transaction:false`, expand/contract, nunca `DROP` na mesma release que remove o uso
- [x] `packages/database`: `Pool` do `pg` com `max` pequeno (10 na api, 5 no worker; orçamento total documentado contra o `max_connections` do RDS, `PERF-02`), `connectionTimeoutMillis`, `idle_in_transaction_session_timeout = 10s`; parser de `int8` (OID 20) para `bigint`, porque o `pg` devolve `bigint` como string por padrão; helper `withTransaction(fn)` que executa `SET LOCAL lock_timeout = '2s'` e `SET LOCAL statement_timeout = '5s'` (`PERF-06`) e traduz `55P03` (lock_not_available) em erro de domínio `ResourceBusy`
- [x] Serialização de dinheiro na borda (`PERF-09`): `Money` usa `bigint` internamente; o mapper HTTP converte para `number` com `Number.isSafeInteger` (falha alto se violado) e nunca passa `BigInt` ao `JSON.stringify`
- [x] IDs UUIDv7 gerados na aplicação (`PERF-10`)
- [x] `main.ts`: `server.keepAliveTimeout = 65_000` e `server.headersTimeout = 66_000`, maiores que o idle timeout de 60 s do ALB (`PERF-01`); `enableShutdownHooks()`; limite de body de 16 KB; `helmet`; sem CORS (`SEC-19`)
- [x] Usuários de banco: `mini_banco_api` (DML nas tabelas da API) e `mini_banco_worker` (SELECT em `transfers`, DML em `fraud_reviews`, `notifications`, `processed_messages`)
- [x] Domínio: `Money` (centavos, inteiro, sem negativos), `Cpf`, `Account.debit/credit`, erros de domínio tipados
- [x] Application: `CreateAccountUseCase`, `GetAccountUseCase`, `TransferFundsUseCase`, `GetStatementUseCase`; ports `AccountRepository`, `TransferRepository`, `IdempotencyStore`, `OutboxWriter`, `UnitOfWork`
- [x] Infra: repositórios SQL (`PgAccountRepository`, `PgTransferRepository`, ...) com queries parametrizadas (`$1, $2`; nunca concatenação de strings) e funções `toDomain(row)` explícitas; `UnitOfWork` que pega um client do pool, executa `BEGIN` / `COMMIT` / `ROLLBACK` e o propaga aos repositórios via `AsyncLocalStorage` (Read Committed + locks explícitos); `SELECT ... FOR UPDATE` ordenado por `id`
- [x] Lint: regra que proíbe template string interpolada como primeiro argumento de `query()` (prevenção de SQL injection)
- [x] Idempotência: `INSERT` da chave primeiro (concorrente bloqueia no índice único até o commit, limitado pelo `lock_timeout`), hash SHA-256 do payload canônico, gravação da resposta no mesmo commit; ordem de locks fixa: chave → contas por `id` (`PERF-08`)
- [x] Extrato com keyset pagination: cursor opaco base64url de `(created_at, id)`, decodificado com zod estrito (`SEC-16`)
- [x] Autenticação por API key (middleware Express antes do roteamento, em vez de `ApiKeyGuard`, para responder 401 antes de 404) com `crypto.timingSafeEqual` sobre hashes SHA-256 (`SEC-08`), validação zod explícita no controller (`parseOrThrow`, para garantir a ordem de TRF-BR-13), filtro global que converte erros de domínio em `problem+json`; erros desconhecidos viram 500 genérico com `correlationId`, sem mensagem do Postgres nem stack (`SEC-13`)
- [x] Swagger servindo `specs/openapi.yaml` em `/docs`
- [x] Testes:
  - unitários (Vitest): `Money`, `Cpf`, use cases com fakes dos ports
  - integração (Testcontainers Postgres): repositórios, locks, `TRF-AC-06`, `TRF-AC-07`, `TRF-AC-11`, `TRF-AC-13..15`, `STM-AC-05`, o invariante `SUM(ledger) = balance`, payloads clássicos de SQL injection (`SEC-09`) e `EXPLAIN` das queries críticas usando índice (`PERF-11`)
  - um banco por worker do Vitest via `CREATE DATABASE ... TEMPLATE` sobre um único container (`PERF-26`)
  - e2e (Supertest + Testcontainers): todos os `ACC-AC`, `TRF-AC` e `STM-AC`, com validação das respostas contra `openapi.yaml`

**Entregáveis:** endpoints `/v1/accounts`, `/v1/transfers`, `/v1/accounts/{id}/statement` funcionando.

**Critério de pronto**
- `pnpm specs:coverage --require=ACC,TRF,STM` passa (todos os níveis de teste esperados), e o CI passa a usar essa flag.
- Demonstrar o teste de 50 transferências concorrentes: saldo final correto e nunca negativo.
- Demonstrar dois `curl` paralelos com a mesma `Idempotency-Key` produzindo uma única transferência.
- Explicar o plano de execução (`EXPLAIN`) da query do extrato usando o índice.

**Prepara para responder:** como evitar saldo negativo sob concorrência? Lock pessimista vs otimista? Níveis de isolamento? Como implementar idempotência? Offset vs cursor? Como aplicar SOLID no NestJS?

---

## Fase 3: Outbox, SQS e worker

**Objetivo:** integração assíncrona confiável com entrega at-least-once, consumidor idempotente e DLQ.

**Tarefas**
- [x] `OutboxRelay` em `apps/api` com claim (`PERF-04`), em loop a cada 1 s (habilitado por `OUTBOX_RELAY_ENABLED`):
  1. transação curta: `UPDATE outbox SET claimed_until = now() + interval '30 seconds', attempts = attempts + 1 WHERE id IN (SELECT id FROM outbox WHERE published_at IS NULL AND (claimed_until IS NULL OR claimed_until < now()) ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *` e commit
  2. `SendMessageBatch` **fora da transação**, com timeout do SDK de 3 s e sem retries longos
  3. `UPDATE outbox SET published_at = now()` para os enviados; `last_error` para as falhas (voltam a ser elegíveis quando o claim expira)
  4. ao receber SIGTERM, para de fazer claims antes de fechar o pool (`PERF-22`)
- [x] Job de limpeza (no relay, a cada hora): apaga `outbox` publicados há mais de 7 dias e `idempotency_keys` expiradas, em lotes (`PERF-12`)
- [x] Message attributes: `correlationId`, `traceparent`, `eventType`
- [x] `apps/worker` (NestJS `createApplicationContext`): poller com long polling (`WaitTimeSeconds=20`, `MaxNumberOfMessages=10`); lote processado com concorrência limitada (`mapWithConcurrency` próprio no lugar do `p-limit`, sem dependência nova; abaixo do pool do worker; `PERF-17`); graceful shutdown: `AbortController` cancela o `ReceiveMessage` pendente e o lote em andamento termina dentro do `stopTimeout` (`PERF-19`)
- [x] Visibility timeout ≥ 6× o p99 de processamento; medir e ajustar os 30 s iniciais (`PERF-18`). *Medido com `pnpm bench` (500 eventos, 50 contas, concorrência 5; Postgres de teste com fsync=off): processamento p95 4 ms / p99 5 ms; tempo invisível até o ack (`inFlightMs`, inclui a espera no lote) p95 9 ms / p99 18 ms; ~980 eventos/s. Os 30 s ficam: a folga sobre o p99 é enorme, mas o limite que importa é o pior caso, e ele é limitado pelos timeouts: 5 statements × `statement_timeout` de 5 s + 3 s de espera por conexão ≈ 28 s < 30 s. Repetir no RDS com Logs Insights (fase 8).*
- [x] Pipeline do handler: validar com zod → `INSERT processed_messages ON CONFLICT DO NOTHING` (se já existe: delete e sai) → **confirmar a transferência em `transfers`** (existe, contas e valor batem; senão erro não-retentável, `SEC-14`) → `FraudRule[]` (`HighAmountRule`, `HighVelocityRule` com janela relativa a `completedAt`, `PERF-20`) → `fraud_reviews` → `notifications` → commit → `DeleteMessage`
- [x] Classificação de erros: inválido (não-retentável) → `ChangeMessageVisibility(0)` para esgotar `maxReceiveCount` rápido; transitório → backoff exponencial via `ChangeMessageVisibility` (5 s, 10 s, 20 s...)
- [x] Script `pnpm dlq:redrive` (usa `StartMessageMoveTask`) e `pnpm dlq:peek`. *O ElasticMQ não responde a `ListMessageMoveTasks`; o acompanhamento do redrive fica para o console/CLI da AWS.*
- [x] Testes:
  - unitários: cada `FraudRule`, classificador de erros
  - integração (Testcontainers Postgres + ElasticMQ): `OBX-AC-01..05`, `PRC-AC-01..08`
  - teste de "crash" do relay: enviar sem marcar `published_at` → evento duplicado → worker aplica uma vez

**Entregáveis:** fluxo completo transferência → evento → antifraude → notificação; DLQ funcionando.

**Critério de pronto**
- Transferência de R$ 15.000,00 gera `fraud_reviews` `FLAGGED` com `HIGH_AMOUNT` em poucos segundos.
- Mensagem malformada enviada à mão (`curl "$SQS_QUEUE_URL?Action=SendMessage&MessageBody=..."`) aparece na DLQ após 5 recebimentos; o redrive a devolve para a fila principal.
- Desligar o ElasticMQ (`docker compose stop sqs`), fazer transferências e religar: todos os eventos são publicados.

**Prepara para responder:** o que é o Transactional Outbox? At-least-once vs exactly-once? Como tornar um consumer idempotente? Standard vs FIFO? Visibility timeout? Quando uma mensagem vai para a DLQ e o que fazer com ela?

---

## Fase 4: Front Next.js

**Objetivo:** UI simples que demonstra App Router corretamente, não apenas um SPA dentro do Next.

**Tarefas**
- [x] Rotas: `/accounts/new`, `/accounts/[accountId]` (saldo + extrato paginado), `/transfers/new`, `/transfers/[transferId]`
- [x] Server Components para leitura (`fetch` no servidor, `cache: 'no-store'` para saldo)
- [x] Server Actions para mutações; a `x-api-key` fica apenas em variável de ambiente do servidor (`API_KEY`, sem prefixo `NEXT_PUBLIC_`), num módulo com `import 'server-only'` (`SEC-25`)
- [x] Revalidar o input com zod **dentro de cada Server Action**, porque elas são endpoints POST públicos e chamáveis sem o formulário (`SEC-24`)
- [x] Next.js e React em versões com os CVEs recentes corrigidos (ex.: CVE-2025-29927, CVE-2025-55182); nenhuma autorização dependente só de middleware (`SEC-26`)
- [x] `fetch`es independentes em Server Components com `Promise.all`; `no-store` só em saldo e extrato (`PERF-23`)
- [x] `Idempotency-Key` gerada **uma vez por formulário renderizado** (campo hidden), de modo que um duplo clique ou retry reutiliza a mesma chave
- [x] Validação no cliente com os schemas zod de `packages/contracts`; erros `problem+json` mapeados para mensagens amigáveis
- [x] Formatação de centavos com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`; o input em reais é convertido para centavos com aritmética de inteiros (sem `parseFloat * 100`)
- [x] `loading.tsx`, `error.tsx`, `not-found.tsx`
- [x] Propagação de `x-correlation-id` do servidor Next para a API
- [x] Testes: componentes com Testing Library; um teste e2e de fumaça com Playwright (criar 2 contas → transferir → ver extrato)

**Entregáveis:** 4 telas funcionais contra a API local.

**Critério de pronto**
- Fluxo completo pelo navegador; duplo clique em "Transferir" gera uma única transferência.
- DevTools → Network não mostra a API key em nenhuma requisição do browser, e um teste de CI procura a key no bundle `.next/static` e falha se encontrar.

**Notas da implementação** (spec `specs/web/spec.md`, `WEB-AC-01..10`)
- Lógica das Server Actions em `apps/web/src/server/{account,transfer}.ts` (testável); os arquivos `'use server'` só chamam e redirecionam. `readForm` rejeita campo extra, repetido ou ausente (`SEC-24`).
- `/transfers/new` chama `await connection()`: sem isso a página poderia ser pré-renderizada no build e todos receberiam a mesma `Idempotency-Key`.
- Duplo envio no navegador: o React enfileira o 2º envio e o descarta quando o 1º redireciona (só um POST sai). O e2e por isso **reenvia o POST capturado** (mesmo `Next-Action`, mesma chave) e confere uma única transferência; a mutação "chave nova por envio" foi pega pelo unitário e pelo e2e.
- Comprovante sem cache do `fetch`: o `x-correlation-id` único por requisição tornaria a chave do cache única (a spec permite cache, não exige).
- `next-env.d.ts` é regenerado pelo build apontando para `.next/types`; fica no `.gitignore` e os tipos do Next vêm de `src/next-types.d.ts`.
- `SEC-26`: Next 16.4.6 e React 19.3.1, posteriores às correções de CVE-2025-29927 e CVE-2025-55182; sem middleware.
- E2E (`pnpm test:web`): Playwright contra o stack local, API em :3101 e web em :3100 (não colide com o `pnpm dev`); job `web-e2e` no CI.

**Prepara para responder:** Server vs Client Components? Server Actions? Onde guardar segredos no Next.js? Como evitar submissão duplicada? Cache no App Router?

---

## Fase 5: Observabilidade local

**Objetivo:** conseguir responder "o que aconteceu com a transferência X?" só com telemetria.

**Tarefas**
- [ ] OpenTelemetry Node SDK em `packages/observability` (carregado antes do Nest): **só** as instrumentações `http`, `pg`, `aws-sdk` e nest, não o pacote completo de auto-instrumentações, para não pesar no startup com 0,25 vCPU (`PERF-05`); export OTLP para o Jaeger
- [ ] Métricas só com dimensões de baixa cardinalidade (`rule`, `reason`, `service`); nunca `accountId` nem `transferId` (`PERF-25`)
- [ ] `/health/*` devolve só `status`, sem versões nem hosts; Swagger `/docs` desligado quando `NODE_ENV=production` (`SEC-17`)
- [ ] Propagação manual de contexto pelo SQS: injetar `traceparent` no relay e extrair no worker (span `transfer.completed process` ligado ao trace original)
- [ ] `traceId` e `spanId` em todos os logs pino (correlação log ↔ trace)
- [ ] Métricas via OTel Metrics API: `transfers_completed_total`, `transfers_rejected_total{reason}`, `outbox_pending` (gauge), `outbox_publish_lag_ms`, `fraud_flagged_total{rule}`, `worker_processing_ms`; exporter Prometheus em `/metrics` localmente
- [ ] `@nestjs/terminus`: `/health/live` (sem dependências) e `/health/ready` (Postgres + relay ativo); worker expõe o mesmo em `:3002`
- [ ] Runbook `docs/runbooks/trace-a-transfer.md`

**Entregáveis:** traces API → Postgres → SQS → worker visíveis no Jaeger; métricas em `/metrics`.

**Critério de pronto**
- A partir de um `x-correlation-id`, encontrar o trace completo no Jaeger e os logs do worker correspondentes.
- Derrubar o Postgres: `/health/ready` passa a 503 e `/health/live` continua 200.

**Prepara para responder:** logs, métricas e traces: quando usar cada um? Correlation ID vs trace ID? Como propagar contexto por uma fila? Liveness vs readiness?

---

## Fase 6: Infraestrutura AWS com Terraform

**Objetivo:** ambiente AWS completo criado e destruído por comando, com custo baixo (detalhes em `aws.md`).

**Tarefas**
- [ ] Setup seguro da conta (`aws.md` §7): MFA no root, IAM Identity Center, Budgets e Cost Anomaly Detection
- [ ] `infra/bootstrap`: bucket de state (versionado, criptografado, bloqueio público), OIDC provider do GitHub, role `mini-banco-github-deploy`, repositórios ECR (`IMMUTABLE`, scan on push, lifecycle mantendo 10 imagens), Budget com e-mail
- [ ] `infra/modules`: `network`, `security-groups`, `alb`, `ecs-cluster`, `ecs-service` (reutilizado por api e worker), `rds`, `sqs`, `secrets`, `observability`, `amplify-web`
- [ ] `infra/envs/lab`: composição dos módulos; backend S3 com `use_lockfile = true`; `default_tags` (`Project=mini-banco`, `Env=lab`, `ManagedBy=terraform`)
- [ ] TLS e borda (`SEC-02`): CloudFront na frente do ALB com header secreto de origem (`random_password`); listener do ALB responde 403 sem o header; `sg-alb` aceita apenas o managed prefix list `com.amazonaws.global.cloudfront.origin-facing`
- [ ] Amplify com **proteção por senha do branch** (`SEC-01`) e `API_BASE_URL` apontando para o domínio do CloudFront
- [ ] RDS: parameter group com `rds.force_ssl = 1`; app conecta com `sslmode=verify-full` e o CA bundle do RDS copiado na imagem (`SEC-20`)
- [ ] Tasks: `--max-old-space-size` ~60% da memória do container da app, `memory_limiter` no ADOT, limites por container (`PERF-21`); `healthCheckGracePeriodSeconds = 60` (`PERF-05`); `minimumHealthyPercent = 100`, `maximumPercent = 200`, deregistration delay 10 s (`PERF-22`); `enable_execute_command = false` por padrão (`SEC-34`); usuário não-root e `readonlyRootFilesystem` (`SEC-35`)
- [ ] Alarme de `CPUCreditBalance` / `CPUSurplusCreditsCharged` do RDS (`PERF-13`)
- [ ] Task definition de migration (`mini-banco-lab-migrate`) usando a imagem da api com `command` = `dbmate up`
- [ ] Outputs gravados no SSM Parameter Store (`/mini-banco/lab/*`) para o CI
- [ ] `tflint`, `terraform fmt -check`, `terraform validate` e `checkov` (ou `trivy config`) no CI
- [ ] `scripts/session-end-check.sh` (busca recursos com a tag `Project=mini-banco` e alerta)

**Entregáveis:** `terraform apply` sobe o ambiente; `terraform destroy` remove tudo exceto o bootstrap.

**Critério de pronto**
- `apply` → deploy manual de uma imagem → `curl https://<cloudfront>/health/ready` 200 → `curl http://<alb>/health/ready` direto **falha** (SG e header) → `destroy` → `session-end-check.sh` sem recursos do `lab`.
- Abrir a URL do Amplify em janela anônima e receber o pedido de senha.
- Explicar cada security group e por que o RDS não tem rota para a internet.

**Prepara para responder:** como estruturar Terraform em módulos? State remoto e lock? Por que sem NAT e qual o trade-off? Como as tasks no Fargate obtêm secrets? Execution role vs task role?

---

## Fase 7: CI/CD com GitHub Actions e OIDC

**Objetivo:** do merge ao deploy sem credenciais de longa duração.

**Tarefas**
- [ ] `ci.yml` (PR): lint, typecheck, unit, integração (Testcontainers no runner), e2e, `specs:coverage`, Spectral, `terraform validate`, `pnpm audit` / Dependabot, build das imagens
- [ ] `deploy.yml` (`workflow_dispatch` + push na `master` quando o ambiente existir), environment `lab` com proteção:
  1. `aws-actions/configure-aws-credentials` com `role-to-assume` (OIDC, `permissions: id-token: write`)
  2. build multi-stage ARM64 (buildx), tag = `git sha`, push para o ECR
  3. scan da imagem (Trivy) com falha em CRITICAL
  4. migration: `aws ecs run-task` da task `mini-banco-lab-migrate` com rede lida do SSM e espera pelo `exitCode` 0
  5. render da nova task definition e `UpdateService` de api e worker com `wait-for-service-stability`
  6. smoke test: `GET /health/ready` e `POST /v1/accounts` de teste
  7. `aws amplify start-job` para o front
- [ ] Rollback documentado: reaplicar a task definition anterior; circuit breaker do ECS com rollback habilitado
- [ ] Migrations sempre retrocompatíveis (expand/contract), com `lock_timeout` e `CONCURRENTLY` (`PERF-15`), e documentadas no `CLAUDE.md`
- [ ] Environment `lab` no GitHub restrito à branch `master` e com aprovação obrigatória, porque o CI é fronteira de confiança e pode rodar a task de migration com a senha master (`SEC-30`)

**Entregáveis:** pipeline completo e role OIDC com escopo mínimo.

**Critério de pronto**
- Um merge na `master` com o ambiente no ar chega ao ECS sem intervenção.
- Mostrar no CloudTrail o `AssumeRoleWithWebIdentity` do GitHub.
- Um PR de outro branch **não** consegue assumir a role (condição `sub`).

**Prepara para responder:** como funciona OIDC entre GitHub e AWS? Por que não usar access keys? Como rodar migrations com segurança em deploy? Blue/green vs rolling? Como fazer rollback?

---

## Fase 8: Observabilidade na AWS

**Objetivo:** detectar problemas antes do usuário e investigar com dados.

**Tarefas**
- [ ] Sidecar ADOT Collector nas tasks: OTLP → X-Ray (traces) e EMF → CloudWatch (métricas, namespace `MiniBanco`)
- [ ] Log groups `/ecs/mini-banco-lab/api` e `/ecs/mini-banco-lab/worker`, retenção de 3 dias
- [ ] SNS `mini-banco-lab-alarms` com assinatura de e-mail
- [ ] Alarmes:
  - ALB `HTTPCode_Target_5XX_Count` > 5 em 5 min
  - ALB `TargetResponseTime` p99 > 1 s por 5 min
  - DLQ `ApproximateNumberOfMessagesVisible` > 0
  - fila principal `ApproximateAgeOfOldestMessage` > 300 s
  - `MiniBanco/outbox_pending` > 100 por 5 min
  - ALB `UnHealthyHostCount` > 0
  - RDS `CPUUtilization` > 80%, `FreeStorageSpace` baixo, `DatabaseConnections` > 70% do `max_connections` (`PERF-02`) e `CPUSurplusCreditsCharged` > 0 (`PERF-13`)
  - CloudFront `5xxErrorRate` > 5%
- [ ] Dashboard `mini-banco-lab`: RPS, 5xx, latência, transfers/min, flagged, outbox pending, idade da fila, DLQ, CPU/memória ECS, conexões RDS
- [ ] CloudWatch Logs Insights: queries salvas (por `correlationId`, erros por rota, top fraud reasons)

**Entregáveis:** dashboard e alarmes via Terraform; trace distribuído no X-Ray.

**Critério de pronto**
- Forçar uma mensagem para a DLQ e receber o e-mail do alarme.
- Partir de um `correlationId` e chegar ao trace no X-Ray e aos logs no Logs Insights.

**Prepara para responder:** quais alarmes você criaria para esse sistema e por quê? Métricas de fila que importam? Como evitar fadiga de alertas? Custo de métricas customizadas?

---

## Fase 9: Game days de troubleshooting

**Objetivo:** praticar diagnóstico sob falha real. Cada cenário vira um runbook em `docs/runbooks/` com **sintoma → investigação → causa → correção → prevenção**.

| # | Cenário (como provocar) | Sintoma | Como investigar | Correção |
|---|---|---|---|---|
| 1 | **IAM faltando no worker:** remover `sqs:DeleteMessage` da task role | Mensagens processadas de novo; `ApproximateReceiveCount` sobe; mensagens acabam na DLQ mesmo com `fraud_reviews` gravado | Logs do worker: `AccessDenied ... sqs:DeleteMessage`; CloudTrail com `errorCode=AccessDenied`; IAM Policy Simulator | Restaurar a permissão via Terraform; redrive da DLQ (o consumer idempotente garante que não haverá efeito duplicado) |
| 2 | **Mensagem malformada:** `aws sqs send-message` com body `{"foo":1}` | Alarme DLQ > 0 | `pnpm dlq:peek`; log `ERROR` com `validationErrors`; `ApproximateReceiveCount=5` | Descartar ou corrigir a mensagem; se o bug for do produtor, corrigir spec, contrato e testes primeiro e depois fazer o redrive |
| 3 | **Secret com valor errado:** alterar a senha em `mini-banco/lab/db-api` | Novas tasks não ficam saudáveis e o deploy não estabiliza | `aws ecs describe-services` (events), `describe-tasks` com `stoppedReason`, logs: `password authentication failed` | Corrigir o secret e `aws ecs update-service --force-new-deployment`, porque secrets são lidos **só no start da task** |
| 4 | **Health check falhando:** path errado no target group ou `/health/ready` dependente de algo quebrado | Tasks em loop de start/stop; ALB 502/503 | Target group → health status e reason; `UnHealthyHostCount`; events do service; `curl` na task via ECS Exec | Corrigir path, porta, `healthCheckGracePeriodSeconds` ou a dependência; circuit breaker faz rollback |
| 5 | **Security group bloqueando o RDS:** remover a regra `5432` de `sg-api` para `sg-rds` | `/health/ready` 503, logs `connect ETIMEDOUT` (timeout, não "refused") | Comparar regras dos SGs; VPC Reachability Analyzer (cobrado por análise; conferir preço); VPC Flow Logs habilitados temporariamente (`REJECT`) | Restaurar a regra via Terraform; detectar drift com `terraform plan` |
| 6 | **Mesma `Idempotency-Key` em paralelo:** script com 20 requisições simultâneas e a mesma chave | Esperado: 1 transferência, 20 respostas iguais. Bug simulado (remover o INSERT antecipado da chave): duplicidade | `SELECT ... GROUP BY idempotency_key HAVING count(*) > 1`; logs por `correlationId`; Performance Insights / `pg_stat_activity` mostrando locks | Garantir a unique constraint + INSERT no início da transação; teste `TRF-AC-06` cobre a regressão |
| 7 | **(extra) Outbox travado:** relay desligado por env var | `outbox_pending` subindo; worker ocioso | Alarme `outbox_pending`; `SELECT count(*) FROM outbox WHERE published_at IS NULL` | Religar; analisar por que o alarme demorou |
| 8 | **(extra) 502 intermitente:** voltar `keepAliveTimeout` para o padrão de 5 s e gerar carga constante | ALB `HTTPCode_ELB_502_Count` esporádico sem erro no log da app | Comparar `ELB_5XX` vs `Target_5XX`; access logs do ALB (`target_status_code = -`) | Restaurar `keepAliveTimeout` > idle timeout do ALB (`PERF-01`) |
| 9 | **(extra) Conta quente:** 50 transferências simultâneas da mesma origem com `lock_timeout` desligado | Latência explode, pool esgota, `/health/ready` falha | `pg_stat_activity` com `wait_event_type = Lock`, métrica de espera do pool | Restaurar `lock_timeout`; ver `TRF-AC-14` respondendo 503 rápido (`PERF-06`) |

**Tarefas**
- [ ] Um script em `scripts/gameday/` por cenário para provocar a falha (e reverter)
- [ ] Executar cada um **sem olhar a causa**, cronometrando o tempo até o diagnóstico
- [ ] Escrever o runbook e um postmortem curto (blameless) por cenário

**Critério de pronto:** seis runbooks escritos; ser capaz de narrar cada investigação em 2 minutos.

**Prepara para responder:** conte um incidente que você investigou. Como você diagnostica uma task do ECS que não sobe? Como diferenciar problema de rede de problema de credencial? O que fazer com mensagens na DLQ?

---

## Fase 10: Segurança e hardening

**Objetivo:** fechar lacunas e saber explicar a distância entre o lab e a produção bancária.

**Tarefas**
- [ ] Revisão de least privilege com IAM Access Analyzer (findings de acesso não usado e validação de policies)
- [ ] Rotação de secrets: senha master do RDS gerenciada pelo RDS no Secrets Manager (`manage_master_user_password`, com rotação automática); procedimento documentado de rotação da senha do app user e da API key
- [ ] Revisar as regras de validação de entrada já implementadas (`ACC-BR-04`, `ACC-AC-08`, `TRF-AC-10`, `TRF-AC-16`) contra o OWASP API Top 10
- [ ] Rate limiting com `@nestjs/throttler` por API key + limite global, com spec de NFR. `trust proxy` configurado com o número exato de hops (CloudFront + ALB), senão o IP visto é sempre o do proxy ou é forjável via `X-Forwarded-For`. Atrás do Amplify todos os usuários compartilham IPs de saída, então limite por IP sozinho não serve (`SEC-18`)
- [ ] Headers de segurança: `helmet` na API; CSP, `X-Frame-Options`, `Referrer-Policy` no Next.js
- [ ] Logs sem PII: redaction de `document`, mascaramento de CPF em respostas de extrato se aplicável
- [ ] CI: `pnpm audit`, Dependabot, CodeQL, Trivy em imagem e IaC, gitleaks para secrets
- [ ] Imagens: base `node:<lts>-slim` ou distroless, usuário não-root, `readonlyRootFilesystem` na task
- [ ] Revisar `docs/risks.md` item a item: status (mitigado / aceito / pendente), teste ou evidência de cada mitigação, e um threat model STRIDE resumido com "o que mudaria em produção" (ver `aws.md` §10)

**Critério de pronto:** pipeline falha em CRITICAL; Access Analyzer sem findings não justificados; rate limit demonstrável (429 com `Retry-After`).

**Prepara para responder:** OWASP API Top 10 aplicado ao projeto? Como rotacionar secrets sem downtime? Defense in depth? O que você mudaria para produção?

---

## Roteiro de entrevista

### NestJS e arquitetura

1. **Como você organiza um serviço NestJS para que o domínio não dependa de framework?**
   - Hexagonal: `domain` (entidades, VOs) sem import de Nest/`pg`; `application` com use cases e ports (interfaces + tokens de injeção); `infrastructure` com controllers e adapters.
   - Os módulos do Nest só fazem o wiring (`{ provide: ACCOUNT_REPOSITORY, useClass: PgAccountRepository }`).
   - *Exemplo:* `TransferFundsUseCase` testado com fakes, sem banco.

2. **Por que separar api e worker em processos distintos?**
   - Escala e falha independentes, perfis de recurso diferentes, deploy independente, e um backlog na fila não derruba a latência da API.
   - *Exemplo:* services ECS separados, task roles diferentes.

3. **Por que SQL puro e não um ORM?**
   - O núcleo do sistema é concorrência: locks, ordem de lock, `SKIP LOCKED`, `ON CONFLICT`. Com SQL explícito, o que roda no banco é exatamente o que está no code review.
   - Custos: mapeamento manual de linhas, tipagem das linhas não verificada pelo compilador (mitigado por testes de integração com Testcontainers) e cuidado com SQL injection (só queries parametrizadas, com lint).
   - Saber o equivalente em ORM: `setLock('pessimistic_write')` no TypeORM, `$queryRaw` no Prisma.
   - *Exemplo:* `PgAccountRepository.lockForUpdate(ids)`, ADR-0004.

### SOLID

4. **Dê um exemplo concreto de Open/Closed e Dependency Inversion no seu projeto.**
   - OCP: `FraudRule` com `evaluate(ctx)`; uma nova regra é uma nova classe registrada, e o `FraudAnalyzer` não muda.
   - DIP: o use case depende de `EventPublisher`/`OutboxWriter`, não do SQS SDK.
   - *Exemplo:* `HighAmountRule`, `HighVelocityRule`.

5. **Onde você violaria SOLID de propósito?**
   - Não criar interfaces para tudo (YAGNI): `GetAccountUseCase` simples pode usar o repositório diretamente. Abstração tem custo.
   - *Exemplo:* ADR-0003, consequências.

### Postgres e concorrência

6. **Como você garante que o saldo nunca fica negativo com transferências simultâneas?**
   - `FOR UPDATE` nas duas contas em ordem de `id` (evita deadlock), checagem de saldo dentro da transação, `CHECK` no banco como última defesa.
   - Alternativa: `UPDATE ... SET balance = balance - x WHERE balance >= x` (atômico, sem leitura prévia) ou lock otimista com `version` + retry.
   - *Exemplo:* `TRF-AC-07`.

7. **Qual nível de isolamento você usa e por quê?**
   - Read Committed + locks explícitos: previsível e sem retries de serialização. `SERIALIZABLE` exigiria retry em erro `40001`.
   - *Exemplo:* `UnitOfWork`.

8. **Como implementar idempotência em uma API de pagamento?**
   - Chave do cliente, unique `(client_id, key)`, hash do payload, resposta armazenada no mesmo commit; replay devolve a resposta original; payload diferente → 422; expiração.
   - Concorrência: o segundo INSERT bloqueia até o primeiro commitar.
   - *Exemplo:* `TRF-AC-04..06`, game day 6.

9. **Offset ou cursor para o extrato?**
   - Offset degrada com páginas profundas e pula ou duplica itens com inserções; keyset por `(created_at, id)` usa índice e é estável.
   - *Exemplo:* `STM-AC-05`.

### Mensageria

10. **O que é Transactional Outbox e que problema resolve?**
    - Dual write (DB + broker) sem transação distribuída. O evento é gravado no mesmo commit e um relay publica depois. Entrega at-least-once.
    - Alternativa: CDC (Debezium) lendo o WAL.
    - Armadilha: chamar o broker dentro da transação que segura os locks. Um broker lento vira um pool de conexões esgotado. Solução: claim curto (`claimed_until`) e envio fora da transação.
    - *Exemplo:* `OutboxRelay` com claim + `SKIP LOCKED` (`PERF-04`, `OBX-AC-04`).

11. **Exactly-once existe?**
    - Na prática: at-least-once + consumer idempotente = efeito exactly-once. SQS FIFO deduplica numa janela de 5 min, mas não protege o efeito colateral do consumidor.
    - *Exemplo:* `processed_messages`, `PRC-AC-04`.

12. **Como você configura retries e DLQ no SQS?**
    - Visibility timeout maior que o tempo de processamento; `maxReceiveCount`; backoff via `ChangeMessageVisibility`; alarme na DLQ; redrive após correção. Erros não retentáveis saem rápido.
    - *Exemplo:* fase 3, game day 2.

### AWS e IAM

13. **Qual a diferença entre task execution role e task role?**
    - Execution: usada pelo agente do ECS para puxar a imagem, escrever logs e ler secrets para injetar. Task: usada pelo código da aplicação (SQS, X-Ray).
    - *Exemplo:* policies em `aws.md` §3.

14. **Como o GitHub Actions faz deploy sem access keys?**
    - OIDC: o token JWT do GitHub vai para `AssumeRoleWithWebIdentity`; a trust policy valida `aud` e `sub` (repo + environment); credenciais temporárias.
    - *Exemplo:* role `mini-banco-github-deploy`.

15. **Por que sem NAT Gateway e o que você faria em produção?**
    - Custo. Tasks em subnet pública com IP público e SG sem ingress da internet; RDS em subnet isolada. Em produção: subnets privadas + NAT ou VPC endpoints, egress filtrado, multi-AZ.
    - *Exemplo:* ADR-0013, `aws.md` §10.

15b. **Por que RDS e não um Postgres gerenciado fora da AWS, como Supabase?**
    - Com o ambiente efêmero, o RDS custa centavos por sessão. Ficar na AWS mantém o banco sem rota para a internet, o acesso controlado por security group, os secrets gerenciados e rotacionados e a migration dentro da VPC. Um banco externo ficaria exposto na internet e acrescentaria problemas de IPv6 e de pooler.
    - *Exemplo:* ADR-0020.

### Observabilidade e troubleshooting

16. **Como você rastreia uma transação que passou por API, fila e worker?**
    - `correlationId` (negócio) + `traceparent` (técnico) propagados como message attributes; logs JSON com ambos; X-Ray service map.
    - *Exemplo:* fase 5, diagrama de sequência.

17. **Uma task do ECS não sobe. Qual seu roteiro?**
    - Events do service → `stoppedReason` da task → logs do container → health check do target group → SG/rede → IAM (pull de imagem e secrets).
    - *Exemplo:* game days 3, 4 e 5.

18. **Quais alarmes importam para um sistema com fila?**
    - Idade da mensagem mais antiga (não só a contagem), DLQ > 0, backlog no outbox, 5xx e latência p99. Alarmar sintoma, não causa.
    - *Exemplo:* fase 8.

### SDD

19. **Como você aplica Spec-Driven Development no dia a dia?**
    - Spec com ACs com ID → contrato versionado → testes que citam IDs → código. CI garante cobertura de ACs e validação de contrato. Revisão começa pela spec.
    - *Exemplo:* `pnpm specs:coverage`, `TRF-AC-06`.

20. **Como versionar um contrato de evento sem quebrar consumidores?**
    - Mudanças aditivas são compatíveis; quebra → novo `eventVersion` e/ou novo tipo, com publicação dupla durante a migração; consumer tolerante (ignora campos desconhecidos).
    - *Exemplo:* `transfer.completed.v1.schema.json`.

### IA no desenvolvimento

21. **Como você usa IA para gerar código sem perder qualidade?**
    - Contexto explícito (`CLAUDE.md`, spec), decomposição em tarefas pequenas, testes gerados a partir dos ACs antes do código, lint/testes obrigatórios, lista de pontos para revisão humana (locks, IAM, dinheiro).
    - *Exemplo:* README §8.

22. **Como você escolhe o modelo e quando usa agentes?**
    - Modelo maior para desenho e revisão de código sensível; menor para tarefas mecânicas. Subagentes para trabalho paralelo isolado (explorar, revisar, rodar testes); nunca delegar decisão de arquitetura sem revisão.
    - *Exemplo:* convenções no `CLAUDE.md`.

### Next.js e segurança

23. **Server Components ou Client Components? Onde ficam segredos?**
    - Server por padrão (dados, segredos, menos JS); Client só para interatividade. Segredos só em env sem `NEXT_PUBLIC_`, usados em Server Actions/Components.
    - *Exemplo:* fase 4, API key nunca no browser.

24. **Quais controles de segurança você aplicou na API?**
    - Validação estrita (zod, `additionalProperties: false`), rate limit, helmet, erros sem stack trace, redaction de PII, least privilege em IAM e no banco, scans no CI. Débito conhecido: autenticação de usuário final.
    - *Exemplo:* fase 10.
