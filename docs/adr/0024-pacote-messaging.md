# 0024. Pacote `packages/messaging` para o cliente SQS

- **Status:** Proposta (revisar)
- **Data:** 2026-11-19
- **Relacionados:** `specs/transfer-processing/spec.md` (OBX-BR-02, PRC-BR-09), ADR-0006, ADR-0007, ADR-0022, `PERF-04`

## Contexto

Na fase 3, três lugares falam com o SQS: o `OutboxRelay` (em `apps/api`), o consumidor (em `apps/worker`) e os scripts da DLQ. Todos precisam do mesmo cliente: endpoint opcional do ElasticMQ (`AWS_ENDPOINT_URL`), timeout por requisição definido (3 s no relay, mais de 20 s no long polling) e poucos retries do SDK, para não esconder falhas nem prender o ciclo do relay. Os testes de integração dos dois apps também precisam do mesmo ElasticMQ em container, com fila e DLQ por arquivo de teste.

## Opções consideradas

1. **Cada app cria o próprio cliente e o próprio container de teste**: nenhuma dependência nova entre pacotes, mas código duplicado. Os timeouts podem divergir sem ninguém perceber, e o helper de teste precisa existir duas vezes.
2. **Importar de um app no outro** (o worker usa `apps/api/...`): quebra a fronteira entre deployables. Um app passa a depender da árvore de outro.
3. **Pacote `packages/messaging`**, no mesmo formato dos outros pacotes (`development` → `src`, `default` → `dist`; subpath `./testing`): um lugar para `createSqsClient`, `describeSqsError`, `parseTraceparent` e o ElasticMQ de teste.

## Decisão

Opção 3. O pacote só tem infraestrutura de transporte: nenhuma regra de negócio, nenhum schema de evento (esses ficam em `packages/contracts`). Os adapters (`SqsEventPublisher` na API, `SqsConsumer` no worker) continuam nos apps, atrás dos ports de cada um.

## Consequências

- Positivas: timeouts e configuração local/AWS num só lugar; um único `globalSetup` do Vitest sobe o ElasticMQ para todos os testes de integração e e2e; `@aws-sdk/client-sqs` fica declarado onde é usado.
- Negativas / custos aceitos: mais um pacote para compilar no `pnpm build` e no `pnpm dev`.
- O que faria revisitar: um segundo transporte (SNS, EventBridge) ou um tipo de mensagem com regras próprias de envio, que pediriam abstrações maiores do que um cliente compartilhado.
