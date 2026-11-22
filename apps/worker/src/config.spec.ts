import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const BASE = {
  DB_HOST: 'db',
  DB_NAME: 'minibanco',
  WORKER_DB_USER: 'mini_banco_worker',
  WORKER_DB_PASSWORD: 'x',
  SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/q',
};

describe('loadConfig: TLS do banco', () => {
  it('[SEC-20] verify-full exige DB_SSL_CA_FILE', () => {
    expect(() => loadConfig({ ...BASE, DB_SSL: 'verify-full' })).toThrow(/DB_SSL_CA_FILE/);
    expect(
      loadConfig({ ...BASE, DB_SSL: 'verify-full', DB_SSL_CA_FILE: '/ca.pem' }).database,
    ).toMatchObject({ ssl: 'verify-full', sslCaFile: '/ca.pem' });
  });
});
