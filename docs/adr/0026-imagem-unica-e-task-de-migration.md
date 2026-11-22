# 0026. Imagem multi-stage por app e migration como task Node na imagem da api

- **Status:** Proposta
- **Data:** 2026-11-20
- **Relacionados:** ADR-0018 (Fargate ARM64), ADR-0019 (dbmate), `SEC-09`, `SEC-20`, `SEC-33`, `SEC-35`, `PERF-21`

## Contexto

A fase 6 precisa de imagens para api e worker e de um jeito de migrar o RDS, que fica em subnets isoladas (o runner do GitHub não o alcança). A migration 0002 cria `mini_banco_api` e `mini_banco_worker` **sem LOGIN e sem senha** (senha nunca no git); local, o `postgres-init.sql` dá o LOGIN. Na AWS alguém precisa fazer isso com as senhas do Secrets Manager. O provider `postgresql` do Terraform não alcança o RDS isolado.

## Opções consideradas

1. **Imagem própria de migration (dbmate oficial + psql)**: separada da app, mas é mais um repositório no ECR, mais um build e `psql` montando `ALTER ROLE` com a senha no shell.
2. **Provider `postgresql` no Terraform**: declarativo, mas exige rota da máquina do apply até o RDS (bastion ou RDS público). Contradiz ADR-0013.
3. **Entrada Node na imagem da api (`dist/migrate.js`)**: roda `dbmate up` (binário da versão do lockfile copiado na imagem) e depois define LOGIN e senha dos papéis com `pg`, reaproveitando o TLS `verify-full` da app.

## Decisão

Opção 3. Um `Dockerfile` multi-stage com targets `api` e `worker` (só `dist/` + dependências de produção, `USER node`, compatível com `readonlyRootFilesystem`, CA bundle do RDS versionado em `infra/certs/`). A task `mini-banco-lab-migrate` usa a imagem da api com `command = node dist/migrate.js` e a execution role própria que lê a senha master e as senhas dos papéis.

`ALTER ROLE ... PASSWORD` não aceita parâmetros; para não montar SQL com o valor (`SEC-09`), a sessão cria uma função `pg_temp` que recebe papel e senha como `$1`/`$2` e usa `format('%I', '%L')` no servidor. Os papéis vêm de uma whitelist.

Ordem na sessão: os services nascem com `desired_count = 0` (variável obrigatória no lab), a migration roda e só então eles sobem para 1 (`scripts/lab.sh up`). Sem isso, a API sobe sem conseguir logar no banco, falha o readiness em loop e o circuit breaker marca o primeiro deploy como falho.

## Consequências

- Positivas: uma imagem testada serve app e migration (mesmo sha); migration idempotente (pode rodar a cada deploy); senha só em env injetada pelo ECS e em parâmetro de query; integração testada contra Postgres real (`apps/api/test/integration/migrate.spec.ts`).
- Negativas / custos aceitos: a imagem da api carrega o binário do dbmate (~20 MB) e as migrations; a task de migration tem a senha master (o CI que a dispara é fronteira de confiança, `SEC-30`, fase 7). O CA bundle versionado precisa ser atualizado quando a AWS rotacionar as CAs do RDS.
- O que faria revisitar: migrations que não cabem em SQL do dbmate, necessidade de rotação automática das senhas dos papéis (aí uma Lambda de rotação do Secrets Manager faria o `ALTER ROLE`), ou IAM database authentication.
