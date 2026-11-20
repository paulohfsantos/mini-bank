import { AccountForm } from '../../../components/account-form';
import ui from '../../../components/ui.module.css';
import { createAccountAction } from './actions';

export default function NewAccountPage() {
  return (
    <>
      <h1>Abrir conta</h1>
      <section className={ui.card}>
        <AccountForm action={createAccountAction} />
      </section>
    </>
  );
}
