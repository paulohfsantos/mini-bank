# mini-banco

Laboratório Full Stack + AWS + Spec-Driven Development: contas e transferências com NestJS, Next.js, PostgreSQL (SQL puro), SQS com Transactional Outbox, Terraform e GitHub Actions com OIDC.

- **Visão geral, arquitetura e domínio:** [`docs/README.md`](docs/README.md)
- **Plano por fases:** [`docs/plan.md`](docs/plan.md)
- **Infraestrutura AWS:** [`docs/aws.md`](docs/aws.md)
- **Riscos de segurança e performance:** [`docs/risks.md`](docs/risks.md)
- **Decisões:** [`docs/adr/`](docs/adr/)
- **Instruções para IA:** [`CLAUDE.md`](CLAUDE.md)

## Início rápido

Pré-requisitos: Node 26 (`.nvmrc`), pnpm 12, Docker.

```bash
pnpm install
pnpm infra:up      # postgres, jaeger (e fila SQS local)
pnpm check         # lint, format, typecheck, test
```
