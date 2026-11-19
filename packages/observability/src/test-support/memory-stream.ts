import { Writable } from 'node:stream';

/** Destino de log em memória para testes: cada linha JSON vira um objeto. */
export class MemoryStream extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(chunk: Buffer, _enc: BufferEncoding, done: (error?: Error | null) => void) {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    done();
  }

  get raw(): string {
    return this.lines.map((l) => JSON.stringify(l)).join('\n');
  }
}
