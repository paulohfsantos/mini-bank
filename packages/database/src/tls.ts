// TLS até o RDS (SEC-20): `verify-full` valida a cadeia contra o CA bundle do RDS e o hostname
// do servidor. `require` só criptografaria; um MITM com certificado qualquer passaria.
import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

export type DbSslMode = 'disable' | 'verify-full';

/**
 * Opções de TLS para o `pg`. Em `verify-full`, o arquivo de CA é obrigatório e lido no boot:
 * arquivo ausente ou sem certificado falha na hora, não na primeira query.
 * O `pg` passa o host como `servername`, e o `tls` do Node confere o hostname por padrão.
 */
export function dbTlsOptions(mode: DbSslMode, caFile?: string): ConnectionOptions | false {
  if (mode === 'disable') return false;
  if (!caFile) throw new Error('DB_SSL=verify-full exige DB_SSL_CA_FILE (CA bundle do RDS)');
  const ca = readFileSync(caFile, 'utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`DB_SSL_CA_FILE não contém certificados PEM: ${caFile}`);
  }
  return { ca, rejectUnauthorized: true };
}
