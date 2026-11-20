# Spec: Front web (`WEB`)

- **Status:** Aprovada para implementação (fase 4)
- **Contrato consumido:** [`openapi.yaml`](../openapi.yaml), todas as operações `/v1`; schemas zod de `packages/contracts`
- **ADRs:** 0005 (zod compartilhado), 0012 (API key de laboratório)
- **Riscos:** `SEC-01`, `SEC-03`, `SEC-24`, `SEC-25`, `SEC-26`, `PERF-23`

## Contexto

`apps/web` é a interface do laboratório: abrir conta, ver saldo e extrato, transferir e consultar uma transferência. É um app Next.js (App Router) em que **o navegador nunca fala com a API**: leituras acontecem em Server Components e mutações em Server Actions, e só o servidor Next conhece a `x-api-key`. Não há login (débito `SEC-01`/`SEC-03`, ADR-0012): qualquer visitante vê qualquer conta pelo id.

## Telas

| Rota | Tipo | Conteúdo |
|---|---|---|
| `/` | Server Component | Links para abrir conta e transferir; campo "ir para a conta" por id |
| `/accounts/new` | Formulário + Server Action | Nome, CPF, saldo inicial em reais |
| `/accounts/[accountId]` | Server Component | Titular, CPF mascarado, saldo e extrato (20 por página, "ver mais" com cursor) |
| `/transfers/new` | Formulário + Server Action | Conta de origem, conta de destino, valor em reais (`?from=<id>` pré-preenche a origem) |
| `/transfers/[transferId]` | Server Component | Comprovante: contas, valor, data, status |

## Regras

- **WEB-BR-01: Segredo só no servidor.** A API key vem de `API_KEY` (sem prefixo `NEXT_PUBLIC_`) e só é lida num módulo com `import 'server-only'`. Nenhuma requisição do navegador carrega `x-api-key` e o bundle do cliente (`.next/static`) não contém o valor (`SEC-25`).
- **WEB-BR-02: Server Action revalida.** Toda Server Action valida a entrada com os schemas zod de `packages/contracts` antes de chamar a API, mesmo que o formulário já tenha validado no cliente: a action é um endpoint POST público (`SEC-24`).
- **WEB-BR-03: Idempotência por formulário.** O formulário de transferência recebe uma `Idempotency-Key` (UUID) gerada **no servidor, uma vez por renderização**, num campo hidden. Reenvio, duplo clique ou retry do mesmo formulário usa a mesma chave. Depois de uma transferência concluída, um formulário novo traz uma chave nova. O botão fica desabilitado enquanto a action está pendente, mas a garantia vem da chave, não do botão.
- **WEB-BR-04: Dinheiro em centavos inteiros.** O valor digitado em reais (`1234,56`, `1.234,56`, `1234`, `0,5`) vira centavos por aritmética de inteiros sobre a string, sem `parseFloat` nem `* 100`. Aceita no máximo 2 casas decimais e separador de milhar `.` só em grupos de 3 dígitos. Rejeita sinal, notação científica, mais de 2 casas e valores acima do teto do contrato. A exibição usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **WEB-BR-05: Erros da API em linguagem de gente.** Cada `code` do `problem+json` vira uma mensagem em português; erros de campo (`errors[]`) aparecem junto do campo. Código desconhecido, 5xx ou falha de rede mostram uma mensagem genérica com o `correlationId` para suporte, nunca stack ou corpo cru.
- **WEB-BR-06: Correlação.** Cada chamada do servidor Next à API envia `x-correlation-id` (UUID novo por renderização/ação), e o mesmo id aparece na mensagem de erro genérica.
- **WEB-BR-07: Cache.** Saldo e extrato com `cache: 'no-store'`. O comprovante de transferência é imutável e pode ser cacheado. Em `/accounts/[accountId]`, conta e extrato são buscados em paralelo (`Promise.all`, `PERF-23`).
- **WEB-BR-08: Ids na URL.** `accountId`/`transferId` que não são UUID resultam em 404 sem chamar a API. `ACCOUNT_NOT_FOUND`/`TRANSFER_NOT_FOUND` da API também viram a página 404 (`not-found.tsx`).
- **WEB-BR-09: Estados de carregamento e erro.** Cada rota com dados tem `loading.tsx`; falha inesperada cai em `error.tsx` com botão "tentar de novo".
- **WEB-BR-10: Versões.** Next.js e React em versões com os CVEs conhecidos corrigidos (`SEC-26`); nenhuma regra de acesso depende só de middleware.

## Critérios de aceite

### WEB-AC-01: Abrir conta
- **Dado** nome, CPF válido não cadastrado e saldo inicial `1.500,00`
- **Quando** o usuário envia o formulário de nova conta
- **Então** é redirecionado para `/accounts/{id}`, que mostra o titular, o CPF mascarado e o saldo `R$ 1.500,00`
- Nível: e2e

### WEB-AC-02: Erros ao abrir conta
- **Dado** um CPF com dígito verificador errado
- **Quando** o usuário sai do campo ou envia
- **Então** aparece "CPF inválido" junto do campo, sem chamada à API
- **E dado** um CPF já cadastrado, o envio mostra "Já existe uma conta para este CPF" junto do campo
- Nível: unitário (componente) + e2e

### WEB-AC-03: Conversão de reais para centavos
- **Dado** as entradas `1.234,56`, `1234,56`, `0,5`, `10`, `0,01`
- **Então** viram `123456`, `123456`, `50`, `1000`, `1`
- **E** `1,234`, `-1`, `1e3`, `abc`, `1.23,45`, `12.345.678,9` (vazio ou acima do teto) são rejeitadas com mensagem
- **E** `150000` centavos é exibido como `R$ 1.500,00`
- Nível: unitário

### WEB-AC-04: Página da conta com extrato
- **Dado** uma conta com 25 lançamentos
- **Quando** o usuário abre `/accounts/{id}`
- **Então** vê o saldo atual e os 20 lançamentos mais recentes (tipo, valor com sinal, saldo após, contraparte com link); "ver mais" mostra os 5 restantes
- **E** `/accounts/{id-inexistente}` e `/accounts/nao-e-uuid` mostram a página 404
- Nível: e2e

### WEB-AC-05: Transferir
- **Dado** duas contas, a origem com saldo suficiente
- **Quando** o usuário transfere `150,00`
- **Então** é redirecionado ao comprovante `/transfers/{id}` com valor, origem, destino e data
- **E** com saldo insuficiente, o formulário mostra "Saldo insuficiente" e nada muda
- Nível: e2e

### WEB-AC-06: Duplo clique gera uma transferência
- **Dado** o formulário de transferência preenchido
- **Quando** o envio é disparado duas vezes em seguida (duplo clique ou reenvio do mesmo formulário)
- **Então** existe uma única transferência, e as duas chamadas à API usaram a mesma `Idempotency-Key`
- Nível: unitário (a action usa a chave do formulário) + e2e

### WEB-AC-07: Server Action chamada sem o formulário
- **Dado** uma chamada direta à action de transferência com valor negativo, conta que não é UUID ou campo extra
- **Quando** a action executa
- **Então** devolve erros de validação e **não** chama a API
- Nível: unitário

### WEB-AC-08: API key nunca chega ao navegador
- **Dado** o app construído (`next build`) e o fluxo completo executado num navegador
- **Então** nenhuma requisição feita pelo navegador tem o header `x-api-key` nem o valor da key, e nenhum arquivo em `.next/static` contém o valor
- Nível: e2e

### WEB-AC-09: Mensagens para cada código de erro
- **Dado** cada `code` do enum `ErrorCode` do contrato
- **Então** existe uma mensagem em português para ele (teste falha se o contrato ganhar um código sem mensagem)
- **E** 5xx, código desconhecido ou falha de rede viram a mensagem genérica com o `correlationId`
- Nível: unitário

### WEB-AC-10: x-correlation-id em toda chamada
- **Dado** qualquer chamada do cliente HTTP do servidor Next à API
- **Então** ela envia `x-api-key` e um `x-correlation-id` válido, e usa `cache: 'no-store'` nas leituras de saldo e extrato
- Nível: unitário

## Requisitos não funcionais

- **WEB-NFR-01:** sem JavaScript no navegador, os formulários continuam funcionando (Server Actions com `<form action>`), só sem a validação instantânea.
- **WEB-NFR-02:** sem biblioteca de UI nem CSS framework: CSS Modules simples. O foco do lab é a arquitetura, não o visual.

## Fora de escopo

Login e autorização por titular (fase 10 / ADR-0012), headers de segurança como CSP (`SEC-27`, fase 10), internacionalização.
