import { UuidSchema } from '@mini-banco/contracts';
import { connection } from 'next/server';
import { TransferForm } from '../../../components/transfer-form';
import ui from '../../../components/ui.module.css';
import { createTransferAction } from './actions';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewTransferPage({ searchParams }: Props) {
  // Obrigatório: sem isto a página poderia ser pré-renderizada no build e todo visitante
  // receberia a MESMA Idempotency-Key (WEB-BR-03).
  await connection();
  const idempotencyKey = crypto.randomUUID();

  const { from } = await searchParams;
  const defaultSource =
    typeof from === 'string' && UuidSchema.safeParse(from).success ? from : undefined;

  return (
    <>
      <h1>Transferir</h1>
      <section className={ui.card}>
        <TransferForm
          action={createTransferAction}
          idempotencyKey={idempotencyKey}
          defaultSource={defaultSource}
        />
      </section>
    </>
  );
}
