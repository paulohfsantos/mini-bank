import type { InputHTMLAttributes } from 'react';
import ui from './ui.module.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  hint?: string;
  error?: string;
}

/** Input com rótulo e erro ligados por aria (o leitor de tela anuncia o erro). */
export function Field({ name, label, hint, error, ...input }: Props) {
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  return (
    <div className={ui.field}>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && (
        <span id={`${name}-hint`} className={ui.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${name}-error`} className={ui.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}
