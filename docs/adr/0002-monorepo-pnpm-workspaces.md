# 0002. Monorepo com pnpm workspaces

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0005

## Contexto

Front, API, worker, contratos compartilhados, infraestrutura e specs evoluem juntos. Uma mudança de contrato precisa atualizar produtor e consumidores no mesmo PR.

## Opções consideradas

1. **Repositórios separados**: isolamento, mas contratos duplicados e PRs coordenados
2. **Nx**: cache e grafo de dependências poderosos, mas mais conceitos e configuração
3. **Turborepo**: cache de tarefas simples, porém mais uma ferramenta
4. **pnpm workspaces puro**: mínimo necessário; `workspace:*` e catálogos de versão nativos

## Decisão

pnpm workspaces puro com catálogo de versões (`catalog:`) e políticas de supply chain no `pnpm-workspace.yaml` (`allowBuilds`, `minimumReleaseAge`).

## Consequências

- Positivas: um PR muda spec, contrato, API, worker e front; versões consistentes; menos ferramentas.
- Custos: sem cache de build; scripts recursivos rodam tudo.
- Revisitar: se o CI passar de ~10 min, adicionar Turborepo para cache.
