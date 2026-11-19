// Erros de domínio com `code` estável (contrato). Não conhecem HTTP: o filtro de exceções
// da borda traduz `code` → status (shared/infrastructure/http/problem.ts).

export type DomainErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_CURSOR'
  | 'SAME_ACCOUNT'
  | 'ACCOUNT_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'DOCUMENT_ALREADY_REGISTERED'
  | 'REQUEST_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_BUSY';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidDocumentError extends DomainError {
  readonly code = 'INVALID_DOCUMENT';
  constructor() {
    super('CPF inválido');
  }
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('Cursor inválido');
  }
}

export class SameAccountError extends DomainError {
  readonly code = 'SAME_ACCOUNT';
  constructor() {
    super('Conta de origem e de destino são a mesma');
  }
}

export type AccountRole = 'source' | 'destination';

export class AccountNotFoundError extends DomainError {
  readonly code = 'ACCOUNT_NOT_FOUND';
  /** TRF-AC-09: em transferências, informa qual papel não existe. */
  constructor(readonly role?: AccountRole) {
    super(
      role
        ? `Conta de ${role === 'source' ? 'origem' : 'destino'} não encontrada`
        : 'Conta não encontrada',
    );
  }
}

export class TransferNotFoundError extends DomainError {
  readonly code = 'TRANSFER_NOT_FOUND';
  constructor() {
    super('Transferência não encontrada');
  }
}

export class DocumentAlreadyRegisteredError extends DomainError {
  readonly code = 'DOCUMENT_ALREADY_REGISTERED';
  constructor() {
    super('Já existe uma conta para este CPF');
  }
}

export class RequestInProgressError extends DomainError {
  readonly code = 'REQUEST_IN_PROGRESS';
  constructor(options?: { cause?: unknown }) {
    super('Outra requisição com a mesma Idempotency-Key está em andamento', options);
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor() {
    super('Idempotency-Key já usada com outro payload');
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';
  constructor() {
    super('Saldo insuficiente');
  }
}

export class AccountBusyError extends DomainError {
  readonly code = 'ACCOUNT_BUSY';
  constructor(options?: { cause?: unknown }) {
    super('Conta ocupada por outra operação; tente novamente', options);
  }
}
