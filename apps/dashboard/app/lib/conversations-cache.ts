/**
 * In-memory cache for client conversations and messages.
 * Anchored to globalThis to survive hot module reload in dev mode.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const globalForConversations = globalThis as unknown as {
  __convListCache?: Map<string, CacheEntry<unknown>>;
  __convDetailCache?: Map<string, CacheEntry<unknown>>;
  __convMessagesCache?: Map<string, CacheEntry<unknown>>;
};

const convListCache = (globalForConversations.__convListCache ??= new Map());
const convDetailCache = (globalForConversations.__convDetailCache ??= new Map());
const convMessagesCache = (globalForConversations.__convMessagesCache ??= new Map());

const LIST_TTL_MS = 15_000; // 15s cache
const MESSAGES_TTL_MS = 10_000; // 10s cache
const DETAIL_TTL_MS = 20_000; // 20s cache

export function getCachedConversationList<T>(key: string): T | null {
  const entry = convListCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  convListCache.delete(key);
  return null;
}

export function setCachedConversationList<T>(key: string, data: T): void {
  convListCache.set(key, {
    data,
    expiresAt: Date.now() + LIST_TTL_MS,
  });
}

export function getCachedConversationMessages<T>(key: string): T | null {
  const entry = convMessagesCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  convMessagesCache.delete(key);
  return null;
}

export function setCachedConversationMessages<T>(key: string, data: T): void {
  convMessagesCache.set(key, {
    data,
    expiresAt: Date.now() + MESSAGES_TTL_MS,
  });
}

export function getCachedConversationDetail<T>(key: string): T | null {
  const entry = convDetailCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  convDetailCache.delete(key);
  return null;
}

export function setCachedConversationDetail<T>(key: string, data: T): void {
  convDetailCache.set(key, {
    data,
    expiresAt: Date.now() + DETAIL_TTL_MS,
  });
}

export function invalidateConversationCaches(organizationId: string, conversationId?: string): void {
  // Invalidate any list caches starting with the organizationId
  for (const key of convListCache.keys()) {
    if (key.startsWith(organizationId)) {
      convListCache.delete(key);
    }
  }

  if (conversationId) {
    convMessagesCache.delete(`${organizationId}:${conversationId}`);
    convDetailCache.delete(`${organizationId}:${conversationId}`);
  }
}
