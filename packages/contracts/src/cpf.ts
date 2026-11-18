// Regras de formato do CPF (ACC-BR-01, ACC-BR-06).
// Ficam no pacote de contratos porque o front valida o mesmo formato antes de enviar.

const ELEVEN_DIGITS = /^\d{11}$/;
const REPEATED_DIGITS = /^(\d)\1{10}$/;

function digitAt(value: string, index: number): number {
  return value.charCodeAt(index) - 48; // '0' = 48
}

/** Dígito verificador sobre os `length` primeiros dígitos (pesos length+1 .. 2). */
function checkDigit(value: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += digitAt(value, i) * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

/**
 * CPF válido: 11 dígitos sem pontuação, dígitos verificadores corretos
 * e não composto por um único dígito repetido (que passaria no cálculo).
 */
export function isValidCpf(value: string): boolean {
  if (!ELEVEN_DIGITS.test(value) || REPEATED_DIGITS.test(value)) {
    return false;
  }
  return checkDigit(value, 9) === digitAt(value, 9) && checkDigit(value, 10) === digitAt(value, 10);
}

/** Máscara usada em todas as respostas: `***.982.247-**` (ACC-BR-06, SEC-21). */
export function maskCpf(value: string): string {
  if (!ELEVEN_DIGITS.test(value)) {
    throw new Error('maskCpf espera 11 dígitos');
  }
  return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`;
}
