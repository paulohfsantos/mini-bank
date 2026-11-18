# 0012. Autenticação por API key de laboratório (débito consciente)

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-01, SEC-03, SEC-04, SEC-08

## Contexto

Autenticação completa de usuário final está fora do escopo do lab. O único cliente da API é o servidor Next.js.

## Opções consideradas

1. **OAuth2/OIDC com Cognito ou outro IdP**: correto para produção, mas desvia o foco do lab
2. **JWT fixo**: parece autenticação sem ser
3. **API key única no header `x-api-key`**: simples e honesta sobre o que é

## Decisão

API key em `x-api-key`, comparada com `crypto.timingSafeEqual`, guardada no Secrets Manager e só no servidor Next. Débito explícito: sem autorização por titular (BOLA) e oráculo de enumeração de CPF. O site público fica atrás da senha do branch no Amplify e só existe durante a sessão.

## Consequências

- Positivas: foco no que o lab quer demonstrar.
- Custos: qualquer portador da key acessa qualquer conta.
- Revisitar: em produção, OIDC + escopos + autorização por recurso (o `sub` do token deve ser dono da conta de origem).
