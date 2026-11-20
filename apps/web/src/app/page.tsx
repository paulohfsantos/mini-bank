import { UuidSchema } from '@mini-banco/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ui from '../components/ui.module.css';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// "Ir para a conta" é um GET para esta mesma página: funciona sem JavaScript (WEB-NFR-01).
export default async function Home({ searchParams }: Props) {
  const { account } = await searchParams;
  const id = typeof account === 'string' ? account.trim() : undefined;
  if (id && UuidSchema.safeParse(id).success) redirect(`/accounts/${id}`);
  const invalid = id !== undefined;

  return (
    <>
      <h1>mini-banco</h1>
      <section className={ui.card}>
        <div className={ui.actions}>
          <Link href="/accounts/new">Abrir uma conta</Link>
          <Link href="/transfers/new">Fazer uma transferência</Link>
        </div>
      </section>
      <section className={ui.card}>
        <h2>Ir para a conta</h2>
        <form method="get" className={ui.form}>
          <div className={ui.field}>
            <label htmlFor="account">Id da conta</label>
            <input
              id="account"
              name="account"
              defaultValue={id}
              placeholder="0193a1b2-7c4d-7e5f-8a6b-..."
              aria-invalid={invalid}
              aria-describedby={invalid ? 'account-error' : undefined}
              autoComplete="off"
            />
            {invalid && (
              <span id="account-error" className={ui.fieldError}>
                Id de conta inválido
              </span>
            )}
          </div>
          <button type="submit" className={ui.button}>
            Abrir
          </button>
        </form>
      </section>
    </>
  );
}
