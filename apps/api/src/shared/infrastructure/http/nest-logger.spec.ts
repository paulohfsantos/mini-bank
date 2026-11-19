import type { Logger } from '@mini-banco/observability';
import { describe, expect, it, vi } from 'vitest';
import { NestPinoLogger } from './nest-logger';

describe('NestPinoLogger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
  const nest = new NestPinoLogger(logger as unknown as Logger);

  it('ruído de boot do Nest (log) vai para debug, não para info', () => {
    nest.log('Mapped {/v1/accounts, POST} route', 'RouterExplorer');
    expect(logger.debug).toHaveBeenCalledWith(
      { context: 'RouterExplorer' },
      'Mapped {/v1/accounts, POST} route',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('avisos e erros do Nest continuam em warn/error', () => {
    nest.warn('w', 'Ctx');
    nest.error('e', 'stack', 'Ctx');
    expect(logger.warn).toHaveBeenCalledWith({ context: 'Ctx' }, 'w');
    expect(logger.error).toHaveBeenCalledWith({ context: 'Ctx', stack: 'stack' }, 'e');
  });
});
