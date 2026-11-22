import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dbTlsOptions } from './tls';

const BUNDLE = resolve(import.meta.dirname, '../../../infra/certs/rds-global-bundle.pem');

describe('dbTlsOptions', () => {
  it('[SEC-20] disable → sem TLS (só local)', () => {
    expect(dbTlsOptions('disable')).toBe(false);
  });

  it('[SEC-20] verify-full valida o certificado com o CA bundle do RDS', () => {
    const options = dbTlsOptions('verify-full', BUNDLE);
    expect(options).toMatchObject({ rejectUnauthorized: true });
    expect(options && options.ca).toContain('-----BEGIN CERTIFICATE-----');
    // Sem checkServerIdentity customizado: o hostname é conferido pelo padrão do Node.
    expect(options && options.checkServerIdentity).toBeUndefined();
  });

  it('[SEC-20] verify-full sem arquivo de CA falha no boot', () => {
    expect(() => dbTlsOptions('verify-full')).toThrow(/DB_SSL_CA_FILE/);
    expect(() => dbTlsOptions('verify-full', '/nao/existe.pem')).toThrow(/ENOENT/);
  });

  it('[SEC-20] arquivo sem certificado PEM é rejeitado', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tls-')), 'vazio.pem');
    writeFileSync(file, 'nada aqui');
    expect(() => dbTlsOptions('verify-full', file)).toThrow(/PEM/);
  });
});
