import { isValidCpf, maskCpf } from '@mini-banco/contracts';
import { InvalidDocumentError } from '../../../shared/domain/errors';

/** Value object do CPF (ACC-BR-01). O valor completo nunca sai pela API (ACC-BR-06). */
export class Cpf {
  private constructor(readonly value: string) {}

  static parse(value: string): Cpf {
    if (!isValidCpf(value)) throw new InvalidDocumentError();
    return new Cpf(value);
  }

  get masked(): string {
    return maskCpf(this.value);
  }

  /** Evita vazar o CPF em logs e mensagens por acidente (SEC-21). */
  toString(): string {
    return this.masked;
  }

  toJSON(): string {
    return this.masked;
  }
}
