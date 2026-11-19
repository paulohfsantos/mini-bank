import type { Transfer as TransferResponse } from '@mini-banco/contracts';
import { TransferNotFoundError } from '../../../shared/domain/errors';
import type { TransferRepository } from './ports';
import { toTransferResponse } from './transfer-mappers';

/** TRF-AC-17. */
export class GetTransferUseCase {
  constructor(private readonly transfers: TransferRepository) {}

  async execute(id: string): Promise<TransferResponse> {
    const transfer = await this.transfers.findById(id);
    if (!transfer) throw new TransferNotFoundError();
    return toTransferResponse(transfer);
  }
}
