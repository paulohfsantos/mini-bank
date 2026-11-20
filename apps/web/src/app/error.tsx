'use client';

import ui from '../components/ui.module.css';
import { GENERIC_MESSAGE } from '../lib/error-messages';

function digestOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return undefined;
  return typeof error.digest === 'string' ? error.digest : undefined;
}

// Em produção o Next troca a mensagem do erro por uma genérica e envia só o `digest`, que
// aparece também no log do servidor: é ele que o usuário passa ao suporte.
// `retry()` (Next 16.2+) busca de novo no servidor; `reset()` só re-renderizaria no
// cliente e mostraria o mesmo erro de API outra vez.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  return (
    <div className={ui.alert} role="alert">
      <p>{GENERIC_MESSAGE}</p>
      {digest && <p className={ui.mono}>Código: {digest}</p>}
      <button type="button" className={ui.button} onClick={retry}>
        Tentar de novo
      </button>
    </div>
  );
}
