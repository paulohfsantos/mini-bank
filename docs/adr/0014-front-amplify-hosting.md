# 0014. Front no Amplify Hosting (SSR)

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-01, SEC-24, SEC-25, SEC-28

## Contexto

O front usa Server Components e Server Actions para manter a API key no servidor.

## Opções consideradas

1. **S3 + CloudFront com export estático**: barato, mas sem servidor; a API key iria para o browser
2. **Next.js como mais um service ECS atrás do ALB**: coerente, mas mais uma task 24h por sessão
3. **Amplify Hosting com SSR**: gerenciado, conectado ao repositório

## Decisão

Amplify Hosting com SSR, `appRoot = apps/web`, proteção por senha do branch. `API_URL` aponta para o CloudFront da API (nome da variável lida em `apps/web/src/server/api.ts`). Conferir na documentação atual: variáveis de ambiente no runtime SSR e suporte a monorepo pnpm.

## Consequências

- Positivas: SSR gerenciado; segredo fica no servidor.
- Custos: API key visível no console do Amplify (débito `SEC-28`); cold starts.
- Revisitar: se as limitações do Amplify atrapalharem, migrar o web para ECS.
