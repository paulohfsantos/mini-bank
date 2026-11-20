// Fuso fixo: servidor e navegador formatam igual (sem mismatch de hidratação).
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
