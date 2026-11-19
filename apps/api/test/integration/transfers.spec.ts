// Integração: TransferFundsUseCase com adapters Postgres reais, como mini_banco_api.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestingModule } from '@nestjs/testing';
import { SPECS_DIR } from '@mini-banco/contracts/testing';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateAccountUseCase } from '../../src/modules/accounts/application/create-account.use-case';
import { OUTBOX_WRITER } from '../../src/modules/transfers/application/ports';
import {
  type TransferFundsCommand,
  type TransferFundsResult,
  TransferFundsUseCase,
} from '../../src/modules/transfers/application/transfer-funds.use-case';
import {
  AccountBusyError,
  InsufficientFundsError,
  RequestInProgressError,
} from '../../src/shared/domain/errors';
import { compileModule, openTestDb, type TestDb } from '../support/app';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let mod: TestingModule;
let createAccount: CreateAccountUseCase;
let transferFunds: TransferFundsUseCase;
let keySeq = 0;

beforeAll(async () => {
  t = await openTestDb({ max: 20 });
  mod = await compileModule(t);
  createAccount = mod.get(CreateAccountUseCase);
  transferFunds = mod.get(TransferFundsUseCase);
});

afterAll(async () => {
  await mod.close();
  await t.close();
});

async function account(initialBalanceCents: number): Promise<string> {
  const created = await createAccount.execute({
    holderName: 'Teste',
    document: nextCpf(),
    initialBalanceCents,
  });
  return created.id;
}

function command(
  source: string,
  destination: string,
  amountCents: number,
  key?: string,
): TransferFundsCommand {
  keySeq += 1;
  return {
    clientId: 'web',
    idempotencyKey: key ?? `k-${keySeq}`,
    sourceAccountId: source,
    destinationAccountId: destination,
    amountCents,
    correlationId: `c-${keySeq}`,
  };
}

async function balance(id: string): Promise<bigint> {
  const { rows } = await t.owner.query<{ balance_cents: string }>(
    'SELECT balance_cents FROM accounts WHERE id = $1',
    [id],
  );
  return BigInt(rows[0]!.balance_cents);
}

async function counts() {
  const { rows } = await t.owner.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM transfers) AS transfers,
           (SELECT count(*) FROM ledger_entries) AS ledger,
           (SELECT count(*) FROM outbox) AS outbox,
           (SELECT count(*) FROM idempotency_keys) AS keys,
           (SELECT sum(balance_cents) FROM accounts) AS total`);
  return rows[0];
}

/** Reconciliação (ADR-0009): para toda conta, OPENING + CREDIT − DEBIT = saldo. */
async function expectLedgerMatchesBalances() {
  const { rows } = await t.owner.query<{ id: string }>(`
    SELECT a.id
      FROM accounts a
      JOIN ledger_entries l ON l.account_id = a.id
     GROUP BY a.id, a.balance_cents
    HAVING sum(CASE l.type WHEN 'DEBIT' THEN -l.amount_cents ELSE l.amount_cents END) <> a.balance_cents`);
  expect(rows).toEqual([]);
}

/** Segura uma transação aberta numa conexão do superusuário até `release()`. */
async function holdLock(sql: string, params: unknown[]) {
  const client = await t.owner.connect();
  await client.query('BEGIN');
  await client.query(sql, params);
  return async () => {
    await client.query('ROLLBACK');
    client.release();
  };
}

describe('TransferFundsUseCase (Postgres real)', () => {
  it('[TRF-AC-02] saldo insuficiente não altera nenhuma tabela', async () => {
    const a = await account(1000);
    const b = await account(0);
    const before = await counts();
    await expect(transferFunds.execute(command(a, b, 1001))).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect(await counts()).toEqual(before);
  });

  it('[TRF-AC-06] 10 requisições paralelas com a mesma chave geram uma única transferência', async () => {
    const a = await account(100_000);
    const b = await account(0);
    const base = command(a, b, 1000, 'same-key-parallel');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => transferFunds.execute(base)),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));

    const { rows } = await t.owner.query('SELECT id FROM transfers WHERE source_account_id = $1', [
      a,
    ]);
    expect(rows).toHaveLength(1);
    expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(ok.map((r: TransferFundsResult) => JSON.stringify(r.body))).size).toBe(1);
    for (const error of failed) expect(error).toBeInstanceOf(RequestInProgressError);
    expect(await balance(a)).toBe(99_000n);
  });

  it('[TRF-AC-07] 50 transferências concorrentes que excedem o saldo: exatamente 10 passam, saldo nunca negativo', async () => {
    const a = await account(10_000);
    const destinations = await Promise.all(Array.from({ length: 50 }, () => account(0)));

    const results = await Promise.allSettled(
      destinations.map((d) => transferFunds.execute(command(a, d, 1000))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));

    for (const reason of reasons) {
      expect(reason instanceof InsufficientFundsError || reason instanceof AccountBusyError).toBe(
        true,
      );
    }
    expect(ok).toHaveLength(10);
    expect(await balance(a)).toBe(0n);
    await expectLedgerMatchesBalances();
  });

  it('[TRF-AC-11] falha depois do débito (outbox) desfaz tudo', async () => {
    const failing = await compileModule(t, (b) =>
      b
        .overrideProvider(OUTBOX_WRITER)
        .useValue({ add: () => Promise.reject(new Error('outbox indisponível')) }),
    );
    try {
      const a = await account(5000);
      const b = await account(0);
      const before = await counts();
      await expect(failing.get(TransferFundsUseCase).execute(command(a, b, 1000))).rejects.toThrow(
        'outbox indisponível',
      );
      expect(await counts()).toEqual(before);
      expect(await balance(a)).toBe(5000n);
    } finally {
      await failing.close();
    }
  });

  it('[TRF-AC-13] chave travada por outra transação além do lock_timeout → RequestInProgressError', async () => {
    const a = await account(5000);
    const b = await account(0);
    const release = await holdLock(
      "INSERT INTO idempotency_keys (client_id, key, request_hash, expires_at) VALUES ('web', 'held-key', $1, now() + interval '1 day')",
      ['0'.repeat(64)],
    );
    try {
      const startedAt = Date.now();
      await expect(transferFunds.execute(command(a, b, 1000, 'held-key'))).rejects.toBeInstanceOf(
        RequestInProgressError,
      );
      expect(Date.now() - startedAt).toBeLessThan(2_500);
    } finally {
      await release();
    }
    const { rows } = await t.owner.query('SELECT 1 FROM transfers WHERE source_account_id = $1', [
      a,
    ]);
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it('[TRF-AC-14] conta de origem travada além do lock_timeout → AccountBusyError em até ~2,5 s, nada muda', async () => {
    const a = await account(5000);
    const b = await account(0);
    const before = await counts();
    const release = await holdLock('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [a]);
    try {
      const startedAt = Date.now();
      await expect(transferFunds.execute(command(a, b, 1000))).rejects.toBeInstanceOf(
        AccountBusyError,
      );
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(1_900); // esperou o lock_timeout de 2 s
      expect(elapsed).toBeLessThan(2_500);
    } finally {
      await release();
    }
    expect(await counts()).toEqual(before);
  });

  it('[TRF-AC-15] 20 A→B e 20 B→A em paralelo terminam sem deadlock', async () => {
    const a = await account(100_000);
    const b = await account(100_000);
    const jobs = [
      ...Array.from({ length: 20 }, () => transferFunds.execute(command(a, b, 100))),
      ...Array.from({ length: 20 }, () => transferFunds.execute(command(b, a, 100))),
    ];
    const results = await Promise.allSettled(jobs);
    const errors = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason as { code?: string }] : [],
    );
    expect(errors.map((e) => e.code)).not.toContain('40P01');
    expect(errors).toEqual([]);
    expect(await balance(a)).toBe(100_000n);
    expect(await balance(b)).toBe(100_000n);
    await expectLedgerMatchesBalances();
  });

  it('[TRF-AC-19] exatamente uma linha no outbox, pendente, com payload válido no JSON Schema', async () => {
    const a = await account(5000);
    const b = await account(0);
    const { body } = await transferFunds.execute(command(a, b, 1234));

    const { rows } = await t.owner.query<{
      event_type: string;
      published_at: Date | null;
      payload: unknown;
      correlation_id: string;
    }>(
      'SELECT event_type, published_at, payload, correlation_id FROM outbox WHERE aggregate_id = $1',
      [body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: 'transfer.completed', published_at: null });

    const schema = JSON.parse(
      readFileSync(resolve(SPECS_DIR, 'events/transfer.completed.v1.schema.json'), 'utf8'),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    expect(ajv.validate(schema, rows[0]!.payload), JSON.stringify(ajv.errors)).toBe(true);
    expect(rows[0]!.correlation_id).toBe(
      (rows[0]!.payload as { correlationId: string }).correlationId,
    );
  });
});
