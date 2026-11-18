# 0010. Tracing com OpenTelemetry, exportando para X-Ray via ADOT

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** PERF-05, PERF-25

## Contexto

Precisamos de traces distribuídos API → Postgres → SQS → worker, local e na AWS, com propagação pela fila.

## Opções consideradas

1. **SDK do X-Ray**: integração direta com AWS, mas acopla o código ao fornecedor (conferir o status de manutenção atual dos SDKs X-Ray)
2. **OpenTelemetry no código + ADOT Collector como sidecar na AWS**: vendor-neutral; local exporta para Jaeger

## Decisão

OpenTelemetry Node SDK com instrumentações selecionadas (`http`, `pg`, `aws-sdk`, nest). `traceparent` vai como message attribute no SQS. Local: OTLP → Jaeger v2. AWS: sidecar ADOT → X-Ray (traces) e EMF → CloudWatch (métricas).

## Consequências

- Positivas: mesmo código em todo ambiente; troca de backend sem mudar a aplicação.
- Custos: sidecar consome memória da task; startup mais lento com 0,25 vCPU.
- Revisitar: se o custo de memória do sidecar pesar, avaliar exporter direto.
