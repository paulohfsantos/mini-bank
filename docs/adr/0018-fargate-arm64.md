# 0018. ECS Fargate em ARM64 (Graviton)

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** PERF-05, PERF-21

## Contexto

As tasks rodam a menor configuração possível; o preço por vCPU-hora importa.

## Opções consideradas

1. **Fargate x86_64**: compatibilidade universal
2. **Fargate ARM64**: mais barato por vCPU-hora, imagens Node multi-arch disponíveis

## Decisão

ARM64 para api, worker e migration, imagens construídas com buildx para `linux/arm64`. O desenvolvimento local em Mac Apple Silicon já é ARM.

## Consequências

- Positivas: menor custo; paridade com a máquina de desenvolvimento.
- Custos: build no CI via emulação ou runner ARM (conferir disponibilidade para o plano da conta GitHub).
- Revisitar: se alguma dependência nativa não tiver build ARM.
