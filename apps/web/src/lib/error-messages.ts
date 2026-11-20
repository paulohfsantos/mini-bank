// WEB-BR-05 / WEB-AC-09: cada código do contrato vira uma frase para o usuário.
// Record<ErrorCode, string>: o typecheck quebra se o contrato ganhar um código sem mensagem.
import type { ErrorCode, Problem } from '@mini-banco/contracts';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Confira os campos destacados.',
  INVALID_DOCUMENT: 'CPF inválido.',
  INVALID_CURSOR: 'Não foi possível carregar mais lançamentos. Recarregue a página.',
  SAME_ACCOUNT: 'A conta de destino precisa ser diferente da conta de origem.',
  IDEMPOTENCY_KEY_REQUIRED: 'O formulário expirou. Recarregue a página e tente de novo.',
  IDEMPOTENCY_KEY_INVALID: 'O formulário expirou. Recarregue a página e tente de novo.',
  UNAUTHORIZED: 'O serviço está indisponível no momento.',
  ACCOUNT_NOT_FOUND: 'Conta não encontrada.',
  TRANSFER_NOT_FOUND: 'Transferência não encontrada.',
  DOCUMENT_ALREADY_REGISTERED: 'Já existe uma conta para este CPF.',
  REQUEST_IN_PROGRESS: 'Esta transferência ainda está sendo processada. Aguarde um instante.',
  PAYLOAD_TOO_LARGE: 'Os dados enviados são grandes demais.',
  IDEMPOTENCY_KEY_REUSED:
    'Este formulário já foi usado para outra transferência. Recarregue a página para fazer uma nova.',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente na conta de origem.',
  ACCOUNT_BUSY: 'A conta está ocupada com outra operação. Tente de novo em instantes.',
  ROUTE_NOT_FOUND: 'Página não encontrada.',
  INTERNAL_ERROR: 'Não foi possível concluir agora. Tente de novo em instantes.',
};

export const GENERIC_MESSAGE = ERROR_MESSAGES.INTERNAL_ERROR;

/** Falha de uma chamada à API, já sem nada que não possa ir para a tela. */
export type Failure =
  | { kind: 'problem'; status: number; problem: Problem }
  | { kind: 'unexpected'; status: number; correlationId: string }
  | { kind: 'network'; correlationId: string };

export interface FailureView {
  message: string;
  /** Só nas falhas genéricas: o usuário passa este id ao suporte. */
  correlationId?: string;
}

export function describeFailure(failure: Failure): FailureView {
  if (failure.kind === 'problem' && failure.status < 500) {
    return { message: ERROR_MESSAGES[failure.problem.code] };
  }
  const correlationId =
    failure.kind === 'problem' ? failure.problem.correlationId : failure.correlationId;
  return { message: GENERIC_MESSAGE, correlationId };
}
