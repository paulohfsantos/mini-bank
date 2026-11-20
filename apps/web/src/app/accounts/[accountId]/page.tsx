import { STATEMENT_DEFAULT_LIMIT, type StatementEntry } from '@mini-banco/contracts';
import Link from 'next/link';
import { FormAlert } from '../../../components/form-alert';
import ui from '../../../components/ui.module.css';
import { formatDateTime } from '../../../lib/dates';
import { formatCents } from '../../../lib/money';
import { getApi } from '../../../server/api';
import { load, requireUuid } from '../../../server/pages';

interface Props {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

const LABEL: Record<StatementEntry['type'], string> = {
  OPENING: 'Abertura',
  DEBIT: 'Transferência enviada',
  CREDIT: 'Transferência recebida',
};

export default async function AccountPage({ params, searchParams }: Props) {
  const accountId = requireUuid((await params).accountId);
  const { cursor: rawCursor } = await searchParams;
  const cursor = typeof rawCursor === 'string' && CURSOR.test(rawCursor) ? rawCursor : undefined;

  const api = getApi();
  // Independentes: em paralelo, não em cascata (WEB-BR-07 / PERF-23).
  const [account, statement] = await Promise.all([
    load(api.getAccount(accountId)),
    load(api.getStatement(accountId, { cursor, limit: STATEMENT_DEFAULT_LIMIT })),
  ]);
  if (!account.ok) return <FormAlert {...account.view} />;

  return (
    <>
      <h1>{account.data.holderName}</h1>
      <section className={ui.card}>
        <p className={ui.muted}>CPF {account.data.documentMasked}</p>
        <p className={ui.muted}>Saldo</p>
        <p className={ui.balance} data-testid="balance">
          {formatCents(account.data.balanceCents)}
        </p>
        <p className={ui.mono}>{account.data.id}</p>
        <div className={ui.actions}>
          <Link href={`/transfers/new?from=${account.data.id}`}>Transferir desta conta</Link>
        </div>
      </section>

      <section className={ui.card}>
        <h2>Extrato</h2>
        {!statement.ok ? (
          <FormAlert {...statement.view} />
        ) : statement.data.items.length === 0 ? (
          <p className={ui.muted}>Nenhum lançamento.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Lançamento</th>
                <th className={ui.num}>Valor</th>
                <th className={ui.num}>Saldo após</th>
              </tr>
            </thead>
            <tbody>
              {statement.data.items.map((entry) => (
                <tr key={entry.id} data-testid="statement-entry">
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    {entry.transferId ? (
                      <Link href={`/transfers/${entry.transferId}`}>{LABEL[entry.type]}</Link>
                    ) : (
                      LABEL[entry.type]
                    )}
                    {entry.counterpartyAccountId && (
                      <>
                        {' · '}
                        <Link
                          href={`/accounts/${entry.counterpartyAccountId}`}
                          className={ui.muted}
                        >
                          {entry.type === 'DEBIT' ? 'para' : 'de'}{' '}
                          {entry.counterpartyAccountId.slice(-8)}
                        </Link>
                      </>
                    )}
                  </td>
                  <td className={`${ui.num} ${entry.type === 'DEBIT' ? ui.debit : ui.credit}`}>
                    {formatCents(entry.amountCents, { sign: entry.type === 'DEBIT' ? '-' : '+' })}
                  </td>
                  <td className={ui.num}>{formatCents(entry.balanceAfterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={ui.actions} style={{ marginTop: '1rem' }}>
          {cursor && <Link href={`/accounts/${accountId}`}>Mais recentes</Link>}
          {statement.ok && statement.data.nextCursor && (
            <Link href={`/accounts/${accountId}?cursor=${statement.data.nextCursor}`}>
              Ver mais
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
