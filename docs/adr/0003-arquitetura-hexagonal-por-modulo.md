# 0003. Arquitetura hexagonal por módulo no NestJS

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0004

## Contexto

A vaga pede OO, SOLID e arquitetura. O domínio (dinheiro, saldo, transferência) precisa ser testável sem banco, fila ou framework, e a infraestrutura (SQL puro, SQS) deve ser substituível.

## Opções consideradas

1. **Camadas clássicas do Nest (controller → service → repository)**: simples, mas regras vazam para services acoplados ao `pg`
2. **Hexagonal por módulo (domain / application / infrastructure)**: ports no `application`, adapters na borda

## Decisão

Hexagonal por módulo. `domain/` não importa Nest nem `pg`; `application/` contém use cases e ports (interfaces + tokens de injeção); `infrastructure/` contém controllers, repositórios SQL e adapters. Os módulos do Nest só fazem o wiring.

## Consequências

- Positivas: use cases testados com fakes; troca de adapter não toca o domínio; SOLID visível (DIP, OCP nas `FraudRule`).
- Custos: mais arquivos e mapeamento explícito. Para casos triviais (ex.: `GetAccount`), aceita-se use case fino sem abstrações extras (YAGNI).
- Revisitar: se a cerimônia superar o benefício em módulos sem regra de negócio.
