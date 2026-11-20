// Tipo do valor que o globalSetup entrega via provide/inject (ver database/testing).
declare module 'vitest' {
  export interface ProvidedContext {
    sqsEndpoint: string;
  }
}

export {};
