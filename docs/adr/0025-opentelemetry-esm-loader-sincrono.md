# 0025. OpenTelemetry em ESM: loader síncrono, sem instrumentação do Nest, health sem Terminus

- **Status:** Proposta
- **Data:** 2026-11-20
- **Relacionados:** ADR-0010, ADR-0023, PERF-05, SEC-17, OBS-BR-01, OBS-BR-04, OBS-BR-11

## Contexto

A ADR-0010 escolheu o OpenTelemetry com as instrumentações `http`, `pg`, `aws-sdk` e nest. Ao implementar (fase 5) apareceram três restrições:

1. Os apps são ESM (ADR-0023). Instrumentar um módulo importado por ESM exige um loader hook. O caminho documentado (`module.register('@opentelemetry/instrumentation/hook.mjs')`) está **depreciado no Node 26** (DEP0205) em favor de `module.registerHooks()`, que roda no mesmo thread.
2. `@opentelemetry/instrumentation-nestjs-core` declara suporte a `@nestjs/core >=4 <12`; no Nest 12 ela não corrige nada (spans do Nest não aparecem).
3. A instrumentação do aws-sdk **sobrescreve** o message attribute `traceparent` no `SendMessageBatch` com o contexto do próprio envio. O relay publica lotes de eventos de requisições diferentes; o contexto do envio não é o de nenhuma delas.

E uma decisão de saúde: o plano citava `@nestjs/terminus`.

## Opções consideradas

1. **`--experimental-loader` / `module.register`**: funciona, mas depreciado no Node 26 e com thread separada para cada resolução.
2. **`import-in-the-middle/register-hooks.mjs` (síncrono, `module.registerHooks`) com `include`** só para os módulos instrumentados: sem depreciação, sem thread, só intercepta `pg`, `pg-pool` e os pacotes de middleware do SDK da AWS.
3. Para o Nest: esperar a instrumentação suportar o 12, **ou** dar nome ao span de servidor com um interceptor próprio.
4. Para o `traceparent`: atributo com outro nome (muda o contrato do evento), **ou** enviar sob `suppressTracing` e criar um span PRODUCER próprio com links.
5. Health: Terminus (respostas com detalhes por dependência; worker teria de virar app HTTP) **ou** o controller existente + `node:http` mínimo no worker.

## Decisão

- Loader síncrono do `import-in-the-middle` (opção 2), registrado em `@mini-banco/observability/register` e carregado com `node --import`. Exige Node com `registerHooks` síncrono (26, ver `.nvmrc`); o register falha alto se não houver.
- Sem instrumentação do Nest: `RouteSpanInterceptor` renomeia o span de servidor do http para `METHOD /rota` e grava `http.route` com o padrão da rota (nunca a URL com ids).
- Relay envia ao SQS sob `suppressTracing`; o span `outbox publish` (PRODUCER, raiz) tem links para os traces dos eventos e o attribute `traceparent` continua sendo o gravado no outbox. Long polling do worker também sem span automático (seria um trace vazio a cada 20 s).
- Sem Terminus: readiness no `HealthController` (Postgres + heartbeat do relay) e `HealthServer` em `node:http` no worker, ambos só com `{"status"}`.

## Consequências

- Positivas: trace único requisição → Postgres → worker (OBS-AC-01, verificado por um teste que sobe os processos do build); +~50 ms no boot da API (OBS-NFR-01); uma dependência a menos (Terminus) e nenhuma morta (nestjs-core).
- Custos: `include` do loader precisa acompanhar as instrumentações (lista em `INSTRUMENTED_MODULES`); spans de controller/guard do Nest não existem; o envio ao SQS do relay não tem span próprio do aws-sdk (o `outbox publish` cobre a duração).
- Revisitar: quando a `instrumentation-nestjs-core` suportar o Nest 12, avaliar trocá-la pelo interceptor.
