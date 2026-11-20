import Link from 'next/link';
import { FormAlert } from '../../../components/form-alert';
import ui from '../../../components/ui.module.css';
import { formatDateTime } from '../../../lib/dates';
import { formatCents } from '../../../lib/money';
import { getApi } from '../../../server/api';
import { load, requireUuid } from '../../../server/pages';

interface Props {
  params: Promise<{ transferId: string }>;
}

const STATUS = { COMPLETED: 'Concluída' } as const;

export default async function TransferPage({ params }: Props) {
  const transferId = requireUuid((await params).transferId);
  const transfer = await load(getApi().getTransfer(transferId));
  if (!transfer.ok) return <FormAlert {...transfer.view} />;
  const t = transfer.data;

  return (
    <>
      <h1>Comprovante de transferência</h1>
      <section className={ui.card}>
        <dl className={ui.dl}>
          <dt>Valor</dt>
          <dd data-testid="amount">{formatCents(t.amountCents)}</dd>
          <dt>Status</dt>
          <dd>{STATUS[t.status]}</dd>
          <dt>Data</dt>
          <dd>{formatDateTime(t.createdAt)}</dd>
          <dt>Origem</dt>
          <dd className={ui.mono}>
            <Link href={`/accounts/${t.sourceAccountId}`}>{t.sourceAccountId}</Link>
          </dd>
          <dt>Destino</dt>
          <dd className={ui.mono}>
            <Link href={`/accounts/${t.destinationAccountId}`}>{t.destinationAccountId}</Link>
          </dd>
          <dt>Id</dt>
          <dd className={ui.mono}>{t.id}</dd>
        </dl>
      </section>
      <div className={ui.actions}>
        <Link href={`/transfers/new?from=${t.sourceAccountId}`}>Nova transferência</Link>
      </div>
    </>
  );
}
