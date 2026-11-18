# 0015. Estado do Terraform em S3 com lock nativo

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-33

## Contexto

O ambiente é criado e destruído por sessão; o state precisa ser remoto, versionado e protegido contra applies simultâneos.

## Opções consideradas

1. **State local**: simples, mas frágil e não compartilhável
2. **S3 + tabela DynamoDB para lock**: padrão antigo, depreciado no backend S3
3. **S3 com `use_lockfile = true`** (Terraform ≥ 1.10)

## Decisão

Bucket S3 versionado, criptografado e com bloqueio público, criado pelo root `infra/bootstrap` (começa com state local e migra). Lock nativo via `use_lockfile`. Roots separados para `bootstrap` (persistente) e `envs/lab` (efêmero).

## Consequências

- Positivas: sem DynamoDB; histórico de versões do state.
- Custos: o state contém segredos (`random_password`), então o acesso ao bucket é restrito.
- Revisitar: não previsto.
