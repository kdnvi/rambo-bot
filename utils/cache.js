const store = new Map();

const TTL = {
  config: 5 * 60 * 1000,
  matches: 2 * 60 * 1000,
  groups: 2 * 60 * 1000,
  players: 2 * 60 * 1000,
  badges: 2 * 60 * 1000,
  votes: 30 * 1000,
  curses: 60 * 1000,
  wagers: 60 * 1000,
};

const DEFAULT_TTL = 30 * 1000;

function ttlFor(key) {
  for (const [prefix, ms] of Object.entries(TTL)) {
    if (key === prefix || key.startsWith(`${prefix}/`)) return ms;
  }
  return DEFAULT_TTL;
}

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return clone(entry.value);
}

export function setCached(key, value) {
  store.set(key, { value: clone(value), expires: Date.now() + ttlFor(key) });
}

function clone(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  return structuredClone(val);
}

export function bustPrefix(prefix) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(`${prefix}/`)) {
      store.delete(key);
    }
  }
}

export function bustAll() {
  store.clear();
}

export function cacheStats() {
  return { size: store.size };
}
