import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const BASE = {
  DB_HOST: 'db',
  DB_NAME: 'minibanco',
  API_DB_USER: 'mini_banco_api',
  API_DB_PASSWORD: 'x',
  API_KEYS: 'web:0123456789abcdef',
};

describe('loadConfig: TLS do banco', () => {
  it('[SEC-20] verify-full sem DB_SSL_CA_FILE falha no boot, sem vazar valores', () => {
    expect(() => loadConfig({ ...BASE, DB_SSL: 'verify-full' })).toThrow(
      /DB_SSL_CA_FILE: obrigatória quando DB_SSL=verify-full/,
    );
    expect(() => loadConfig({ ...BASE, DB_SSL: 'require' })).toThrow(/DB_SSL/);
  });

  it('[SEC-20] verify-full com CA e disable por padrão', () => {
    expect(
      loadConfig({ ...BASE, DB_SSL: 'verify-full', DB_SSL_CA_FILE: '/ca.pem' }).database,
    ).toMatchObject({ ssl: 'verify-full', sslCaFile: '/ca.pem' });
    expect(loadConfig(BASE).database.ssl).toBe('disable');
  });
});
