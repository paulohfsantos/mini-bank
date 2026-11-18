# 0020. RDS em vez de Postgres gerenciado fora da AWS (Supabase, Neon)

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0013, SEC-20

## Contexto

Surgiu a dúvida se um Postgres gratuito fora da AWS reduziria custo.

## Opções consideradas

1. **Supabase/Neon (free tier)**: custo zero e dados persistentes entre sessões
2. **RDS `db.t4g.micro` efêmero**

## Decisão

RDS. Com o ambiente efêmero, o RDS custa ~US$ 0,06 por sessão de 3 h (~US$ 0,75/mês com 12 sessões), menos que o ALB e os IPv4 públicos. Fora da AWS se perderiam subnets isoladas, SG app → banco, senha master gerenciada e rotacionada no Secrets Manager, migration dentro da VPC, game day de SG e alarmes RDS. O banco ficaria exposto à internet (só senha); as conexões diretas do Supabase são IPv6 (a VPC é só IPv4) e o pooler em modo transação limita recursos de sessão. Valores aproximados; conferir preços e limites atuais.

## Consequências

- Positivas: material de entrevista sobre AWS de ponta a ponta; postura de segurança defensável.
- Custos: dados recriados por seed a cada sessão.
- Revisitar: se fosse preciso manter dados entre sessões sem pagar RDS 24×7.
