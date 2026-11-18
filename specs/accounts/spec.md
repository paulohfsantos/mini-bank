# Spec: Contas (`ACC`)

- **Status:** Aprovada para implementação (fase 2)
- **Contrato:** [`openapi.yaml`](../openapi.yaml) → `POST /v1/accounts`, `GET /v1/accounts/{accountId}`; schemas `CreateAccountRequest`, `Account`, `Problem`

## Contexto

Um cliente da API (no lab, o servidor Next.js) abre contas para titulares identificados por CPF e consulta conta e saldo. Não há depósito externo: o saldo inicial é informado na abertura (débito consciente `SEC-05`, limitado por teto).

## Regras de negócio

- **ACC-BR-01: CPF válido.** `document` tem exatamente 11 dígitos (sem pontuação), dígitos verificadores corretos e não é uma sequência repetida (`00000000000`, `11111111111`, ...).
- **ACC-BR-02: Saldo inicial inteiro.** `initialBalanceCents` é inteiro em centavos, ≥ 0.
- **ACC-BR-03: Teto do saldo inicial.** `initialBalanceCents` ≤ `10_000_000` (R$ 100.000,00) (`SEC-05`, `SEC-06`).
- **ACC-BR-04: Nome do titular.** O valor recebido tem no máximo 120 caracteres; ele é normalizado em NFC e aparado (trim), e depois disso tem de 1 a 120 caracteres e nenhum caractere de controle (`SEC-15`).
- **ACC-BR-05: Um CPF, uma conta.** Não pode haver duas contas com o mesmo `document`.
- **ACC-BR-06: CPF mascarado nas respostas.** Respostas nunca devolvem o CPF completo: `documentMasked` no formato `***.456.789-**` (`SEC-21`).
- **ACC-BR-07: Lançamento de abertura.** A criação gera, na mesma transação, um lançamento `OPENING` no ledger com `amountCents = initialBalanceCents` e `balanceAfterCents = initialBalanceCents` (inclusive quando o valor é 0).
- **ACC-BR-08: Autenticação.** Todas as operações exigem `x-api-key` válida (ADR-0012).

## Critérios de aceite

### ACC-AC-01: Criar conta com dados válidos
- **Dado** um CPF válido ainda não cadastrado
- **Quando** `POST /v1/accounts` com `{ holderName, document, initialBalanceCents: 150000 }`
- **Então** a resposta é `201` com `Account` (`id` UUID, `balanceCents = 150000`, `documentMasked`), header `Location: /v1/accounts/{id}`, e existe um lançamento `OPENING` de 150000 para a conta
- Nível: e2e

### ACC-AC-02: CPF já cadastrado
- **Dado** uma conta existente com o CPF X
- **Quando** `POST /v1/accounts` com o mesmo CPF X
- **Então** `409` com `code = DOCUMENT_ALREADY_REGISTERED` e nenhuma conta nova é criada
- Observação: a resposta revela que o CPF já é cliente (oráculo de enumeração, débito `SEC-04`)
- Nível: e2e

### ACC-AC-03: Saldo inicial inválido
- **Dado** `initialBalanceCents` negativo, decimal (`10.5`), string (`"100"`) ou acima de `10_000_000`
- **Quando** `POST /v1/accounts`
- **Então** `400` com `code = VALIDATION_ERROR` e `errors[]` apontando `initialBalanceCents`
- Nível: e2e (um caso por variação) + unitário no schema

### ACC-AC-04: CPF inválido
- **Dado** `document` com dígito verificador errado, sequência repetida, menos ou mais de 11 dígitos ou com pontuação
- **Quando** `POST /v1/accounts`
- **Então** `400` com `code = INVALID_DOCUMENT`
- Nível: e2e + unitário no value object `Cpf`

### ACC-AC-05: Consultar conta existente
- **Dado** uma conta criada com saldo inicial S e que participou de transferências
- **Quando** `GET /v1/accounts/{id}`
- **Então** `200` com `Account` e `balanceCents` igual ao saldo atual
- Nível: e2e

### ACC-AC-06: Conta inexistente
- **Dado** um UUID válido que não corresponde a nenhuma conta
- **Quando** `GET /v1/accounts/{id}`
- **Então** `404` com `code = ACCOUNT_NOT_FOUND`
- **E** um `accountId` que não é UUID resulta em `400` com `code = VALIDATION_ERROR`
- Nível: e2e

### ACC-AC-07: Sem autenticação
- **Dado** uma requisição sem `x-api-key` ou com key inválida
- **Quando** qualquer operação de contas
- **Então** `401` com `code = UNAUTHORIZED`, sem revelar se o recurso existe
- Nível: e2e

### ACC-AC-08: Corpo grande ou com campos extras
- **Dado** um corpo acima de 16 KB, ou com um campo não previsto (ex.: `balanceCents`)
- **Quando** `POST /v1/accounts`
- **Então** `413` com `code = PAYLOAD_TOO_LARGE`, ou `400` com `code = VALIDATION_ERROR` respectivamente
- Nível: e2e

### ACC-AC-09: Nome do titular normalizado
- **Dado** `holderName` com espaços nas pontas e caracteres compostos em NFD
- **Quando** `POST /v1/accounts`
- **Então** a conta é salva e devolvida com o nome aparado e em NFC
- **E** um nome vazio após trim, com mais de 120 caracteres ou com caractere de controle resulta em `400 VALIDATION_ERROR`
- Nível: unitário no schema + e2e

### ACC-AC-10: CPF mascarado
- **Dado** uma conta com CPF `52998224725`
- **Quando** `POST /v1/accounts` ou `GET /v1/accounts/{id}`
- **Então** a resposta contém `documentMasked = "***.982.247-**"` e não contém o CPF completo em nenhum campo
- Nível: e2e

## Casos de erro

| Situação | Status | `code` |
|---|---|---|
| Corpo inválido (tipos, limites, campo extra) | 400 | `VALIDATION_ERROR` |
| CPF inválido | 400 | `INVALID_DOCUMENT` |
| Sem/inválida `x-api-key` | 401 | `UNAUTHORIZED` |
| Conta não encontrada | 404 | `ACCOUNT_NOT_FOUND` |
| CPF já cadastrado | 409 | `DOCUMENT_ALREADY_REGISTERED` |
| Corpo > 16 KB | 413 | `PAYLOAD_TOO_LARGE` |
| Erro inesperado | 500 | `INTERNAL_ERROR` (sem detalhes internos; `SEC-13`) |

## Requisitos não funcionais

- **ACC-NFR-01:** `GET /v1/accounts/{id}` p95 < 50 ms no ambiente local.
- **ACC-NFR-02:** o CPF completo nunca aparece em logs (redaction de `document`; `SEC-21`).

## Riscos relacionados

`SEC-03` (BOLA, débito), `SEC-04`, `SEC-05`, `SEC-06`, `SEC-08`, `SEC-13`, `SEC-15`, `SEC-21`.
