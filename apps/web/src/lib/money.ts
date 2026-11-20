// WEB-BR-04: reais digitados → centavos inteiros, sem float em nenhum passo.
// A string é validada por regex e convertida com BigInt; a exibição usa Intl com uma
// string decimal exata (Intl.NumberFormat aceita strings desde o ES2023).

/** `1234`, `1.234`, `1234,5`, `1.234,56`: milhar só em grupos de 3, até 2 casas. */
const REAIS = /^(?<int>\d{1,3}(?:\.\d{3})+|\d+)(?:,(?<frac>\d{1,2}))?$/;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export type ParseResult = { ok: true; cents: number } | { ok: false; message: string };

export interface ParseOptions {
  /** Mínimo em centavos (padrão 0). Transferência usa 1. */
  min?: number;
  /** Teto em centavos, do contrato (MAX_TRANSFER_CENTS, MAX_INITIAL_BALANCE_CENTS). */
  max: number;
}

/** Espaços comuns no lugar do NBSP do Intl: mensagens legíveis e comparáveis. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

export function parseReais(input: string, { min = 0, max }: ParseOptions): ParseResult {
  const text = input.trim().replace(/^R\$\s*/, '');
  if (text === '') return { ok: false, message: 'Informe um valor' };

  const match = REAIS.exec(text);
  if (!match?.groups) return { ok: false, message: 'Valor inválido. Use o formato 1.234,56' };

  const reais = BigInt(match.groups.int!.replaceAll('.', ''));
  const centavos = BigInt((match.groups.frac ?? '').padEnd(2, '0'));
  const cents = reais * 100n + centavos;

  if (cents > BigInt(max))
    return { ok: false, message: `O valor máximo é ${plain(formatCents(max))}` };
  if (cents < BigInt(min)) {
    return {
      ok: false,
      message:
        min === 1
          ? 'Informe um valor maior que zero'
          : `O valor mínimo é ${plain(formatCents(min))}`,
    };
  }
  return { ok: true, cents: Number(cents) };
}

export interface FormatOptions {
  /** Prefixo para lançamentos do extrato: `- R$ 12,34` / `+ R$ 12,34`. */
  sign?: '+' | '-';
}

export function formatCents(cents: number, { sign }: FormatOptions = {}): string {
  const value = BigInt(cents);
  const abs = value < 0n ? -value : value;
  const decimal = `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  // O tipo do Intl só aceita number/bigint, mas o runtime aceita string decimal exata.
  const formatted = BRL.format(decimal as unknown as number);
  return sign ? `${sign} ${formatted}` : formatted;
}
