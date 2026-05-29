"use client";

type CacheEntry<T> = {
  at: number;
  data?: T;
  promise?: Promise<T>;
};

type CachedJsonOptions<T> = {
  ttl?: number;
  storageTtl?: number;
  force?: boolean;
  init?: RequestInit;
  key?: string;
  onUpdate?: (data: T) => void;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 60_000;
const DEFAULT_STORAGE_TTL = 5 * 60_000;
const STORAGE_PREFIX = "fnos-client-cache:";

function isBrowser() {
  return typeof window !== "undefined";
}

function cacheKey(url: string, key?: string) {
  return key || url;
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

function readStorage<T>(key: string, maxAge: number): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; data?: T };
    if (!parsed?.at || Date.now() - parsed.at > maxAge) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, data: unknown) {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage is only a speed hint; ignore quota/private-mode failures.
  }
}

function remember<T>(key: string, data: T) {
  memoryCache.set(key, { at: Date.now(), data });
  writeStorage(key, data);
}

export function readCachedJson<T>(url: string, options: Pick<CachedJsonOptions<T>, "key" | "storageTtl"> = {}) {
  const key = cacheKey(url, options.key);
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (cached?.data !== undefined) return cached.data;
  return readStorage<T>(key, options.storageTtl ?? DEFAULT_STORAGE_TTL);
}

export function cachedJson<T>(url: string, options: CachedJsonOptions<T> = {}): Promise<T> {
  const key = cacheKey(url, options.key);
  const now = Date.now();
  const ttl = options.ttl ?? DEFAULT_TTL;
  const storageTtl = options.storageTtl ?? Math.max(ttl, DEFAULT_STORAGE_TTL);
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined;

  if (!options.force && cached?.data !== undefined && now - cached.at < ttl) {
    return Promise.resolve(cached.data);
  }

  if (!options.force && cached?.promise) return cached.promise;

  const stored = !options.force ? readStorage<T>(key, storageTtl) : null;
  if (stored !== null) {
    memoryCache.set(key, { at: now, data: stored });
    if (options.onUpdate) {
      void refreshCachedJson<T>(url, options).catch(() => undefined);
    }
    return Promise.resolve(stored);
  }

  return refreshCachedJson<T>(url, options);
}

export function refreshCachedJson<T>(url: string, options: CachedJsonOptions<T> = {}) {
  const key = cacheKey(url, options.key);
  const promise = fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...(options.init || {}),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((data as { error?: unknown }).error || `HTTP ${res.status}`));
      return data as T;
    })
    .then((data) => {
      remember(key, data);
      options.onUpdate?.(data);
      return data;
    })
    .catch((error) => {
      const entry = memoryCache.get(key);
      if (entry?.promise === promise) memoryCache.delete(key);
      throw error;
    });

  memoryCache.set(key, { at: Date.now(), promise });
  return promise;
}

export function invalidateClientCache(match?: string) {
  if (!match) {
    memoryCache.clear();
    if (isBrowser()) {
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith(STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
      }
    }
    return;
  }

  for (const key of Array.from(memoryCache.keys())) {
    if (key.includes(match)) memoryCache.delete(key);
  }
  if (isBrowser()) {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(STORAGE_PREFIX) && key.includes(match)) window.sessionStorage.removeItem(key);
    }
  }
}
