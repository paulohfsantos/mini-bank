import { describe, expect, it } from 'vitest';
import { dbmateUrl, type MigrationTarget } from './migrate';

const TARGET: MigrationTarget = {
  host: 'mini-banco-lab-db.abc.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'minibanco',
  user: 'mbadmin',
  password: 'p@ss:w/rd#?&%',
  ssl: 'verify-full',
  caFile: '/app/certs/rds-global-bundle.pem',
};

describe('dbmateUrl', () => {
  it('[SEC-20] verify-full com o CA bundle do RDS', () => {
    const url = new URL(dbmateUrl(TARGET));
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('sslrootcert')).toBe('/app/certs/rds-global-bundle.pem');
    expect(url.hostname).toBe(TARGET.host);
    expect(url.pathname).toBe('/minibanco');
  });

  it('senha com caracteres reservados de URL sobrevive ao parse', () => {
    const url = new URL(dbmateUrl(TARGET));
    expect(decodeURIComponent(url.password)).toBe(TARGET.password);
    expect(decodeURIComponent(url.username)).toBe('mbadmin');
  });

  it('[SEC-20] verify-full sem CA falha antes de conectar', () => {
    const { caFile: _ignored, ...noCa } = TARGET;
    expect(() => dbmateUrl(noCa)).toThrow(/CA bundle/);
  });
});
