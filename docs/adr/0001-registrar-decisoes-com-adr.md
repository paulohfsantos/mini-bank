# 0001. Registrar decisões arquiteturais com ADRs

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** —

## Contexto

O projeto serve de material de entrevista: cada escolha precisa de justificativa rastreável. Decisões tomadas em conversa ou só no código se perdem e acabam reabertas sem contexto.

## Opções consideradas

1. **Wiki ou documento único de arquitetura**: fácil de começar, mas sem histórico por decisão e desatualiza rápido
2. **ADRs curtas no repositório (formato MADR reduzido)**: versionadas junto ao código, revisadas em PR, uma decisão por arquivo

## Decisão

ADRs em `docs/adr/NNNN-titulo.md`, a partir de `0000-template.md`. ADR aceita não é editada no mérito; uma mudança gera nova ADR que substitui a anterior.

## Consequências

- Positivas: histórico explícito do porquê; a IA consulta antes de propor mudanças (regra no `CLAUDE.md`).
- Custos: disciplina de escrever ADR em toda decisão relevante.
- Revisitar: nunca. É a base do processo.
