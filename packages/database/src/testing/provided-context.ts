// Tipo do valor que o globalSetup entrega via provide/inject. Fica num módulo próprio,
// carregado pelo index de ./testing, para que os pacotes consumidores também o enxerguem.
declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export {};
