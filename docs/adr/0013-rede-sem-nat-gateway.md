# 0013. Rede sem NAT Gateway: subnets públicas e isoladas

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-29, ADR-0021

## Contexto

Custo baixo é requisito. Um NAT Gateway custa mais por hora que o resto do ambiente; VPC interface endpoints para todos os serviços custariam ainda mais.

## Opções consideradas

1. **Subnets privadas + NAT Gateway**: padrão de produção, caro para o lab
2. **Subnets privadas + VPC interface endpoints**: sem internet, mas ~7 endpoints × 2 AZs
3. **Tasks em subnets públicas com IP público e SG fechado; RDS em subnets isoladas**

## Decisão

Tasks ECS em subnets públicas com `assignPublicIp`, sem ingress da internet (`sg-api` só aceita o ALB; `sg-worker` sem ingress). RDS em subnets isoladas, sem rota para o IGW. S3 Gateway Endpoint (gratuito) para os layers do ECR.

## Consequências

- Positivas: custo mínimo; RDS inalcançável pela internet.
- Custos: IPv4 públicos cobrados; egress das tasks não filtrado; um SG errado expõe a task.
- Revisitar: em produção, subnets privadas + NAT/endpoints + egress filtrado.
