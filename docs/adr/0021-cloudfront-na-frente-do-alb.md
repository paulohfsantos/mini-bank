# 0021. CloudFront na frente do ALB para TLS sem domínio próprio

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-02, SEC-18, ADR-0013

## Contexto

Sem domínio próprio não há certificado ACM para o DNS `*.elb.amazonaws.com`; a chamada Amplify → ALB levaria a API key em texto claro pela internet.

## Opções consideradas

1. **HTTP direto no ALB**: zero custo, key em claro
2. **Domínio no Route 53 + ACM no ALB**: correto, ~US$ 0,50/mês + domínio
3. **CloudFront na frente do ALB**: HTTPS gratuito em `*.cloudfront.net`

## Decisão

CloudFront com cache desligado na frente do ALB. O `sg-alb` só aceita o managed prefix list de origem do CloudFront; o listener responde 403 por padrão e só encaminha se o header secreto `X-Origin-Verify` bater. Com domínio próprio, ACM no ALB fecha também o trecho CloudFront → ALB.

## Consequências

- Positivas: TLS no trecho público; ALB inalcançável diretamente.
- Custos: trecho CloudFront → ALB em HTTP; minutos extras de propagação em cada apply/destroy; `trust proxy` precisa contar dois hops.
- Revisitar: ao ter domínio próprio.
