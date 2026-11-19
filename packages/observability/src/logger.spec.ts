import { describe, expect, it } from 'vitest';
import { runWithCorrelationId } from './correlation';
import { createLogger } from './logger';
import { MemoryStream } from './test-support/memory-stream';

function setup() {
  const stream = new MemoryStream();
  const logger = createLogger({ service: 'api', level: 'info', destination: stream });
  return { stream, logger };
}

describe('createLogger', () => {
  it('emite JSON com service, level textual e horário ISO', () => {
    const { stream, logger } = setup();
    logger.info('olá');
    expect(stream.lines[0]).toMatchObject({ service: 'api', level: 'info', msg: 'olá' });
    expect(String(stream.lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('inclui o correlationId do contexto em toda linha, sem passar explicitamente', () => {
    const { stream, logger } = setup();
    runWithCorrelationId('c-123', () => logger.info('dentro'));
    logger.info('fora');
    expect(stream.lines[0]).toMatchObject({ correlationId: 'c-123' });
    expect(stream.lines[1]).not.toHaveProperty('correlationId');
  });

  it('[SEC-21] mascara document, x-api-key e authorization nos níveis usuais do objeto', () => {
    const { stream, logger } = setup();
    logger.info(
      {
        document: '52998224725',
        body: { document: '52998224725' },
        req: { headers: { 'x-api-key': 'segredo', authorization: 'Bearer abc' } },
      },
      'tentativa',
    );
    expect(stream.raw).not.toContain('52998224725');
    expect(stream.raw).not.toContain('segredo');
    expect(stream.raw).not.toContain('Bearer abc');
    expect(stream.lines[0]).toMatchObject({
      document: '[REDACTED]',
      req: { headers: { 'x-api-key': '[REDACTED]', authorization: '[REDACTED]' } },
    });
  });

  it('respeita o nível configurado', () => {
    const { stream, logger } = setup();
    logger.debug('não aparece');
    expect(stream.lines).toHaveLength(0);
  });
});
