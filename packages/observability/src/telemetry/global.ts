// Referência global ao SDK iniciado por register.ts. Módulo leve de propósito: os apps
// importam `shutdownTelemetry` sem carregar o SDK e as instrumentações.
export interface Telemetry {
  /** Exporta os spans pendentes (testes). */
  forceFlush(): Promise<void>;
  /** OBS-BR-02: flush e encerramento com teto de tempo; nunca lança. */
  shutdown(timeoutMs?: number): Promise<void>;
}

const GLOBAL_KEY = Symbol.for('mini-banco.telemetry');
type GlobalWithTelemetry = typeof globalThis & { [GLOBAL_KEY]?: Telemetry };

export function getTelemetry(): Telemetry | undefined {
  return (globalThis as GlobalWithTelemetry)[GLOBAL_KEY];
}

export function setTelemetry(telemetry: Telemetry | undefined): void {
  if (telemetry) (globalThis as GlobalWithTelemetry)[GLOBAL_KEY] = telemetry;
  else delete (globalThis as GlobalWithTelemetry)[GLOBAL_KEY];
}

/** Encerra o SDK iniciado por `register.ts`, se houver (chamado no shutdown dos apps). */
export async function shutdownTelemetry(timeoutMs?: number): Promise<void> {
  await getTelemetry()?.shutdown(timeoutMs);
}
