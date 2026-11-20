'use client';

import { useFormStatus } from 'react-dom';
import ui from './ui.module.css';

/** Desabilitado enquanto a action roda. Conforto, não garantia: quem garante é a chave. */
export function SubmitButton({ children, pendingText }: { children: string; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={ui.button} disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
