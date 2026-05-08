interface SlackState {
  userId: string;
  channelId: string;
  teamId: string;
  data: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

const store = new Map<string, SlackState>();
const DEFAULT_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, state] of store.entries()) {
    if (now > state.expiresAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function saveState(
  key: string,
  userId: string,
  channelId: string,
  teamId: string,
  data: Record<string, unknown> = {},
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  const now = Date.now();
  store.set(key, {
    userId,
    channelId,
    teamId,
    data,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
}

export function getState(key: string): SlackState | undefined {
  const state = store.get(key);
  if (!state) return undefined;
  if (Date.now() > state.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return state;
}

export function deleteState(key: string): void {
  store.delete(key);
}

export function updateStateData(key: string, data: Record<string, unknown>): void {
  const state = store.get(key);
  if (state) {
    state.data = { ...state.data, ...data };
  }
}
