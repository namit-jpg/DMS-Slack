import { logger } from '../utils/logger';

interface IdempotencyEntry {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  result?: unknown;
  createdAt: number;
  ttlMs: number;
}

const store = new Map<string, IdempotencyEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.createdAt > entry.ttlMs) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function checkIdempotency(
  idempotencyKey: string,
): 'processing' | 'completed' | 'new' {
  const entry = store.get(idempotencyKey);
  if (!entry) return 'new';
  if (Date.now() - entry.createdAt > entry.ttlMs) {
    store.delete(idempotencyKey);
    return 'new';
  }
  if (entry.status === 'completed') return 'completed';
  return 'processing';
}

export function markProcessing(idempotencyKey: string): void {
  store.set(idempotencyKey, {
    id: idempotencyKey,
    status: 'processing',
    createdAt: Date.now(),
    ttlMs: TTL_MS,
  });
  logger.debug({ idempotencyKey }, 'Marked idempotency as processing');
}

export function markCompleted(idempotencyKey: string, result?: unknown): void {
  const entry = store.get(idempotencyKey);
  if (entry) {
    entry.status = 'completed';
    entry.result = result;
  } else {
    store.set(idempotencyKey, {
      id: idempotencyKey,
      status: 'completed',
      result,
      createdAt: Date.now(),
      ttlMs: TTL_MS,
    });
  }
  logger.debug({ idempotencyKey }, 'Marked idempotency as completed');
}

export function markFailed(idempotencyKey: string): void {
  const entry = store.get(idempotencyKey);
  if (entry) {
    entry.status = 'failed';
  } else {
    store.set(idempotencyKey, {
      id: idempotencyKey,
      status: 'failed',
      createdAt: Date.now(),
      ttlMs: TTL_MS,
    });
  }
  logger.debug({ idempotencyKey }, 'Marked idempotency as failed');
}

export function getResult(idempotencyKey: string): unknown | undefined {
  return store.get(idempotencyKey)?.result;
}
