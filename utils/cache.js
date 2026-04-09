const store = new Map();
const bustGeneration = new Map();

const TTL = {
  config: 5 * 60 * 1000,
  matches: 2 * 60 * 1000,
  groups: 2 * 60 * 1000,
  players: 2 * 60 * 1000,
  badges: 2 * 60 * 1000,
  votes: 30 * 1000,
  curses: 60 * 1000,
  wagers: 60 * 1000,
  flavor: 24 * 60 * 60 * 1000,
};

const DEFAULT_TTL = 30 * 1000;

function ttlFor(key) {
  for (const [prefix, ms] of Object.entries(TTL)) {
    if (key === prefix || key.startsWith(`${prefix}/`)) return ms;
  }
  return DEFAULT_TTL;
}

function prefixOf(key) {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

export function getGeneration(key) {
  return bustGeneration.get(prefixOf(key)) || 0;
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

export function getSubkey(parentKey, childPath) {
  const entry = store.get(parentKey);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(parentKey);
    return undefined;
  }
  if (entry.value === null || entry.value === undefined) return null;
  let val = entry.value;
  for (const seg of childPath.split('/')) {
    if (val === null || val === undefined || typeof val !== 'object') return null;
    val = val[seg];
  }
  return clone(val ?? null);
}

export function setCached(key, value, generation) {
  if (generation !== undefined && generation !== getGeneration(key)) return;
  store.set(key, { value: clone(value), expires: Date.now() + ttlFor(key) });
}

function clone(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  return structuredClone(val);
}

export function bustPrefix(prefix) {
  bustGeneration.set(prefix, (bustGeneration.get(prefix) || 0) + 1);
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}/`)) {
      store.delete(key);
    }
  }
}
