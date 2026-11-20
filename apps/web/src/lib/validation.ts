// Checagens de campo usadas no cliente (ao sair do campo) e na Server Action.
import { HolderNameSchema, isValidCpf, UuidSchema } from '@mini-banco/contracts';

/** Aceita `529.982.247-25`; o contrato quer só os 11 dígitos. */
export function normalizeCpf(value: string): string {
  return value.replace(/[\s.-]/g, '');
}

/** Mesma regra no cliente (ao sair do campo) e na action. */
export function cpfError(value: string): string | undefined {
  const digits = normalizeCpf(value);
  if (!/^\d{11}$/.test(digits)) return 'O CPF deve ter 11 dígitos';
  if (!isValidCpf(digits)) return 'CPF inválido';
  return undefined;
}

export function holderNameError(value: string): string | undefined {
  if (value.trim() === '') return 'Informe o nome do titular';
  if (!HolderNameSchema.safeParse(value).success)
    return 'Nome inválido: até 120 caracteres, sem caracteres de controle';
  return undefined;
}

export function accountIdError(value: string, label: 'origem' | 'destino'): string | undefined {
  return UuidSchema.safeParse(value.trim()).success
    ? undefined
    : `Informe o id da conta de ${label}`;
}
