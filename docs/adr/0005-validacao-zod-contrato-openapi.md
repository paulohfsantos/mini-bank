# 0005. Validação com zod e `openapi.yaml` como contrato

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0002

## Contexto

Spec-first exige um contrato versionado (`specs/openapi.yaml`) que seja a fonte de verdade. Também precisamos de validação em runtime na API, no worker (eventos) e no front (formulários).

## Opções consideradas

1. **class-validator + Swagger code-first**: idiomático no Nest, mas o contrato nasce do código (code-first) e não serve ao front
2. **zod em `packages/contracts` + `openapi.yaml` escrito à mão**: schemas compartilhados por api, worker e web; contrato independente do código

## Decisão

zod em `packages/contracts`, compartilhado. `openapi.yaml` é escrito à mão; tipos TS são gerados dele (`openapi-typescript`). A coerência é garantida por testes: exemplos do contrato validados contra os schemas zod, e respostas e2e validadas contra o `openapi.yaml`. O Swagger UI serve o próprio arquivo.

## Consequências

- Positivas: um schema para três consumidores; contrato revisável em PR antes do código.
- Custos: dois artefatos (yaml e zod) que precisam de teste para não divergir.
- Revisitar: se a divergência virar fonte recorrente de bugs, gerar zod a partir do OpenAPI.
