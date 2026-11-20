// Ports do worker em memória, com rollback por snapshot (como a API).
import type {
  FraudReview,
  FraudReviews,
  IdGenerator,
  Notification,
  Notifications,
  Notifier,
  ProcessedMessages,
  StoredTransfer,
  TransferReader,
  UnitOfWork,
} from '../../src/processing/application/ports';

export class State {
  processed = new Set<string>();
  reviews: FraudReview[] = [];
  notifications: Notification[] = [];
  delivered: Notification[] = [];
  transfers = new Map<string, StoredTransfer & { createdAt: Date }>();
}

export function createFakes() {
  const state = new State();
  let n = 0;
  const uow: UnitOfWork = {
    async run(work) {
      const snapshot = {
        processed: new Set(state.processed),
        reviews: [...state.reviews],
        notifications: [...state.notifications],
      };
      try {
        return await work();
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  };
  const ids: IdGenerator = {
    next: () => `0193a1b2-7c4d-7e5f-8a6b-${String(++n).padStart(12, '0')}`,
  };
  const processed: ProcessedMessages = {
    markProcessed: (consumer, eventId) => {
      const key = `${consumer}:${eventId}`;
      if (state.processed.has(key)) return Promise.resolve(false);
      state.processed.add(key);
      return Promise.resolve(true);
    },
  };
  const transfers: TransferReader = {
    findById: (id) => Promise.resolve(state.transfers.get(id) ?? null),
    countBySourceBetween: (source, from, to) =>
      Promise.resolve(
        [...state.transfers.values()].filter(
          (t) => t.sourceAccountId === source && t.createdAt >= from && t.createdAt <= to,
        ).length,
      ),
  };
  const reviews: FraudReviews = {
    insert: (r) => {
      state.reviews.push(r);
      return Promise.resolve();
    },
  };
  const notifications: Notifications = {
    insertMany: (list) => {
      state.notifications.push(...list);
      return Promise.resolve();
    },
  };
  const notifier: Notifier = { notify: (x) => void state.delivered.push(x) };
  return { state, uow, ids, processed, transfers, reviews, notifications, notifier };
}
