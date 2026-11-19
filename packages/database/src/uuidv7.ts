// UUIDv7 (RFC 9562) gerado na aplicação (PERF-10): os 48 bits iniciais são o instante
// em milissegundos, então ids novos caem no fim do índice B-tree (sem page splits
// aleatórios como no v4) e ordenar por id ≈ ordenar por criação.
//
// Layout: unix_ts_ms (48) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
// rand_a é usado como contador dentro da mesma milissegundo (método 1 da RFC), o que
// garante ordem estritamente crescente no processo, inclusive se o relógio voltar.
import { randomBytes, randomInt } from 'node:crypto';

const MAX_COUNTER = 0xfff;
let lastMs = -1;
let counter = 0;

export function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    // Começa na metade inferior para sobrar espaço de incremento na mesma milissegundo.
    counter = randomInt(0, 0x800);
  } else if (++counter > MAX_COUNTER) {
    lastMs += 1; // contador esgotado: avança o relógio lógico
    counter = 0;
  }

  const bytes = randomBytes(16);
  let ms = lastMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
