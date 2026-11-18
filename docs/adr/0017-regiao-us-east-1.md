# 0017. Região `us-east-1`

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** —

## Contexto

O lab é pago do próprio bolso e não tem dados reais.

## Opções consideradas

1. **`sa-east-1`**: baixa latência a partir do Brasil e residência de dados, mas tipicamente mais cara (conferir)
2. **`us-east-1`**: preço de referência mais baixo, todos os serviços primeiro

## Decisão

`us-east-1`. Em produção bancária, `sa-east-1` seria avaliada por LGPD/Bacen e latência, com DR em outra região.

## Consequências

- Positivas: custo menor; métricas de billing nativas.
- Custos: ~110–150 ms de latência a partir do Brasil, irrelevante para estudo.
- Revisitar: se o lab passar a lidar com dados reais.
