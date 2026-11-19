// Integração: extrato sob concorrência, plano de execução, GRANTs e SQL injection.
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateAccountUseCase } from '../../src/modules/accounts/application/create-account.use-case';
import { GetAccountUseCase } from '../../src/modules/accounts/application/get-account.use-case';
import { GetStatementUseCase } from '../../src/modules/statement/application/get-statement.use-case';
import {
  FIRST_PAGE_SQL,
  NEXT_PAGE_SQL,
} from '../../src/modules/statement/infrastructure/pg-statement.repository';
import { TransferFundsUseCase } from '../../src/modules/transfers/application/transfer-funds.use-case';
import { compileModule, openTestDb, type TestDb } from '../support/app';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let mod: TestingModule;
let createAccount: CreateAccountUseCase;
let transferFunds: TransferFundsUseCase;
let getStatement: GetStatementUseCase;
let seq = 0;

beforeAll(async () => {
  t = await openTestDb();
  mod = await compileModule(t);
  createAccount = mod.get(CreateAccountUseCase);
  transferFunds = mod.get(TransferFundsUseCase);
  getStatement = mod.get(GetStatementUseCase);
});

afterAll(async () => {
  await mod.close();
  await t.close();
});

const newAccount = async (cents: number) =>
  (
    await createAccount.execute({
      holderName: 'Teste',
      document: nextCpf(),
      initialBalanceCents: cents,
    })
  ).id;

const transfer = (source: string, destination: string, amountCents: number) => {
  seq += 1;
  return transferFunds.execute({
    clientId: 'web',
    idempotencyKey: `p-${seq}`,
    sourceAccountId: source,
    destinationAccountId: destination,
    amountCents,
    correlationId: `c-${seq}`,
  });
};

describe('extrato', () => {
  it('[STM-AC-05] lançamentos já commitados aparecem uma vez; novos não aparecem nas páginas seguintes', async () => {
    const a = await newAccount(1_000_000);
    const b = await newAccount(0);
    for (let i = 0; i < 29; i++) await transfer(a, b, 100); // 1 OPENING + 29 DEBIT = 30

    const first = await getStatement.execute({ accountId: a, limit: 10 });
    const original = new Set<string>();
    first.items.forEach((item) => original.add(item.id));

    // Chegam 5 lançamentos novos enquanto o cliente pagina.
    for (let i = 0; i < 5; i++) await transfer(a, b, 1);

    const seen = [...first.items.map((i) => i.id)];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await getStatement.execute({ accountId: a, limit: 10, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    const { rows } = await t.owner.query<{ id: string }>(
      'SELECT id FROM ledger_entries WHERE account_id = $1 ORDER BY created_at, id LIMIT 30',
      [a],
    );
    expect(new Set(seen)).toEqual(new Set(rows.map((r) => r.id)));
  });

  it('[PERF-11] as queries do extrato usam o índice keyset, sem Sort, com 20 mil lançamentos', async () => {
    const a = await newAccount(0);
    const other = await newAccount(0);
    await t.owner.query(
      `INSERT INTO ledger_entries (id, account_id, type, amount_cents, balance_after_cents, created_at)
       SELECT gen_random_uuid(), CASE WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END, 'OPENING', 0, 0,
              now() - g * interval '1 second'
         FROM generate_series(1, 20000) AS g`,
      [a, other],
    );
    await t.owner.query('ANALYZE ledger_entries');

    for (const [sql, params] of [
      [FIRST_PAGE_SQL, [a, 21]],
      [NEXT_PAGE_SQL, [a, 21, '1795000000000000', '0193a1b2-7c4d-7e5f-8a6b-000000000001']],
    ] as const) {
      // sql é constante do repositório; só os valores vão como parâmetros.
      const explain = `EXPLAIN ${sql}`;
      const { rows } = await t.owner.query<{ 'QUERY PLAN': string }>(explain, [...params]);
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('ledger_entries_account_keyset_idx');
      expect(plan).not.toMatch(/\bSort\b/);
    }
  });
});

describe('segurança do banco', () => {
  it('[SEC-09] payloads clássicos de SQL injection são tratados como dados', async () => {
    const payloads = ["Robert'); DROP TABLE accounts;--", "' OR '1'='1", '1; SELECT pg_sleep(5)--'];
    for (const holderName of payloads) {
      const created = await createAccount.execute({
        holderName,
        document: nextCpf(),
        initialBalanceCents: 0,
      });
      const found = await mod.get(GetAccountUseCase).execute(created.id);
      expect(found.holderName).toBe(holderName);
    }
    const { rows } = await t.owner.query("SELECT to_regclass('public.accounts') AS t");
    expect(rows[0]).toEqual({ t: 'accounts' });
  });

  it('mini_banco_api não apaga histórico financeiro nem enxerga tabelas do worker', async () => {
    const client = await t.db.pool.connect();
    try {
      const { rows } = await client.query<{ current_user: string }>('SELECT current_user');
      expect(rows[0]?.current_user).toBe('mini_banco_api');
      for (const sql of [
        'DELETE FROM accounts',
        'DELETE FROM transfers',
        'DELETE FROM ledger_entries',
        'SELECT * FROM fraud_reviews',
        'SELECT * FROM notifications',
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      client.release();
    }
  });

  it('o CHECK do banco é a última linha de defesa contra saldo negativo', async () => {
    const a = await newAccount(10);
    await expect(
      t.db.pool.query('UPDATE accounts SET balance_cents = -1 WHERE id = $1', [a]),
    ).rejects.toMatchObject({
      code: '23514',
    });
  });
});
