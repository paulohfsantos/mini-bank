# 0023. ESM em todo o monorepo, build com SWC e testes com Vitest

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0002, ADR-0003, ADR-0018, PERF-26, SEC-32

## Contexto

Na fase 0 os apps e pacotes Node eram CommonJS, com Jest + `@swc/jest`. No início da fase 2, o NestJS 12 (major atual) passou a ser publicado só como ESM (`"type": "module"`). O projeto também adotou imports relativos **sem extensão** (`from './cpf'`), por preferência do time. Em ESM nativo com `moduleResolution: NodeNext`, o Node exige a extensão (`'./cpf.js'`), e o suporte do Jest a ESM ainda é experimental (`--experimental-vm-modules`).

## Opções consideradas

1. **NestJS 11 e manter CommonJS**: nada muda; fica um major atrás e com upgrade obrigatório depois.
2. **NestJS 12 com apps CommonJS via `require(esm)`**: o Node 26 permite; o Jest precisaria transpilar o ESM do Nest dentro de `node_modules`, mais lento e frágil.
3. **ESM com `NodeNext`**: padrão "puro", mas exige `.js` em todo import relativo, contra a convenção do projeto.
4. **ESM com `moduleResolution: bundler` no typecheck, build com SWC (`resolveFully`) e Vitest**: imports sem extensão no fonte; o SWC acrescenta `.js` na saída; o Vitest roda ESM nativamente.

## Decisão

Opção 4. Todos os pacotes têm `"type": "module"`. O `tsc` só faz typecheck (`noEmit`, `moduleResolution: bundler`, `verbatimModuleSyntax`). O build usa `swc` com `module.resolveFully` e `jsc.baseUrl`, gerando ESM que o Node executa sem loader. Os testes usam Vitest com `unplugin-swc` (decorators legados + `emitDecoratorMetadata`, que o esbuild não emite e o Nest precisa para injeção de dependência). Pacotes do workspace exportam a condição `development` → `src/` (usada pelo typecheck via `customConditions` e pelo Vitest via `resolve.conditions`) e `default` → `dist/` (runtime).

Validado num spike antes da migração: Nest 12 com DI por metadata, build SWC executado pelo Node, Supertest no Vitest e typecheck limpo.

## Consequências

- Positivas: Nest no major atual; imports sem extensão; testes mais rápidos (Vitest + SWC); um único sistema de módulos no repo. O deploy na AWS não muda: o container continua executando `node dist/main.js`.
- Negativas / custos aceitos: `tsc` não gera mais a saída, então o build depende do SWC, que não checa tipos (o CI roda `pnpm typecheck` à parte). `__dirname` não existe (usar `import.meta.dirname`). Import de subcaminho de pacote CommonJS sem `exports` (ex.: `ajv/dist/2020`) só funciona onde há resolver (Vitest); em código de runtime, preferir o ponto de entrada do pacote. Na fase 5, a auto-instrumentação do OpenTelemetry em ESM exige `node --import ./instrumentation.js`.
- O que faria revisitar esta decisão: o typescript-eslint suportar TS 7 com emissão nativa que reescreva extensões, ou o SWC deixar de manter `resolveFully`.
