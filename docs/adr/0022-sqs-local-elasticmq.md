# 0022. SQS local com ElasticMQ em vez de LocalStack

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0007, PRC-AC-05, OBX-AC-02, SEC-32

## Contexto

O plano original usava LocalStack para emular o SQS localmente e nos testes de integração. Na fase 0, a imagem atual (`localstack/localstack:2026.10.8`) encerrou com `License activation failed`: ela passou a exigir `LOCALSTACK_AUTH_TOKEN`. Localmente só precisamos de SQS (fila principal + DLQ).

## Opções consideradas

1. **LocalStack com token de conta gratuita**: mantém a stack original, mas exige conta externa, token no `.env` e um secret no GitHub para os testes de integração no CI (PRs de forks não teriam acesso)
2. **Imagem antiga do LocalStack sem exigência de token**: funciona hoje, mas fica congelada, sem correções de segurança
3. **ElasticMQ (`softwaremill/elasticmq-native`)**: open source, só SQS, configuração declarativa de filas e DLQ, sem conta

## Decisão

ElasticMQ 1.7.1 (imagem nativa) em `:9324`, com filas declaradas em `infra/local/elasticmq.conf` (visibility 30 s, long polling 20 s, DLQ com `maxReceiveCount = 5`, `sqs-limits = strict`). A aplicação aponta para ele via `AWS_ENDPOINT_URL`; na AWS a variável não existe e o SDK usa o SQS real. Nos testes de integração, Testcontainers com container genérico do ElasticMQ.

Verificado na fase 0: a mensagem vai para a DLQ no 6º recebimento e `StartMessageMoveTask` (base do `pnpm dlq:redrive`) é aceito.

## Consequências

- Positivas: nenhuma conta ou segredo para rodar local e CI; sobe em segundos; filas versionadas como código.
- Custos: o ElasticMQ é uma reimplementação, então diferenças sutis em relação ao SQS real são possíveis (atributos, limites, erros). A paridade é coberta pelos smoke tests no ambiente `lab` da AWS (fases 7–8). A imagem não tem curl, então a prontidão é verificada do host por `pnpm infra:check`.
- Revisitar: se precisarmos emular outros serviços AWS localmente (S3, SNS etc.), reavaliar LocalStack com token.
