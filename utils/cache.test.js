import { jest } from '@jest/globals';
import { getCached, setCached, getSubkey, bustPrefix, getGeneration } from './cache.js';

describe('cache', () => {
  beforeEach(() => {
    bustPrefix('test');
    bustPrefix('config');
    bustPrefix('matches');
    bustPrefix('players');
    bustPrefix('votes');
    bustPrefix('wagers');
    bustPrefix('curses');
    bustPrefix('badges');
    bustPrefix('flavor');
  });

  describe('getCached / setCached', () => {
    test('returns undefined for unknown key', () => {
      expect(getCached('test/unknown')).toBeUndefined();
    });

    test('stores and retrieves a value', () => {
      setCached('test/key', { foo: 'bar' });
      expect(getCached('test/key')).toEqual({ foo: 'bar' });
    });

    test('returns a clone, not the same reference', () => {
      const original = { foo: 'bar' };
      setCached('test/ref', original);
      const retrieved = getCached('test/ref');
      expect(retrieved).toEqual(original);
      expect(retrieved).not.toBe(original);
    });

    test('returns undefined after entry expires', async () => {
      jest.useFakeTimers();
      setCached('test/expire', 'value');
      jest.advanceTimersByTime(31000);
      expect(getCached('test/expire')).toBeUndefined();
      jest.useRealTimers();
    });

    test('stores null value', () => {
      setCached('test/null', null);
      expect(getCached('test/null')).toBeNull();
    });

    test('does not store when generation mismatch', () => {
      const gen = getGeneration('test');
      bustPrefix('test');
      setCached('test/stale', 'value', gen);
      expect(getCached('test/stale')).toBeUndefined();
    });

    test('stores when generation matches', () => {
      const gen = getGeneration('test');
      setCached('test/match', 'value', gen);
      expect(getCached('test/match')).toBe('value');
    });

    test('stores primitive values', () => {
      setCached('test/num', 42);
      expect(getCached('test/num')).toBe(42);
      setCached('test/str', 'hello');
      expect(getCached('test/str')).toBe('hello');
      setCached('test/bool', true);
      expect(getCached('test/bool')).toBe(true);
    });
  });

  describe('getSubkey', () => {
    test('returns undefined when parent key not in cache', () => {
      expect(getSubkey('test/missing', 'child')).toBeUndefined();
    });

    test('returns null when parent value is null', () => {
      setCached('test/nullparent', null);
      expect(getSubkey('test/nullparent', 'child')).toBeNull();
    });

    test('returns nested value', () => {
      setCached('test/obj', { a: { b: 42 } });
      expect(getSubkey('test/obj', 'a/b')).toBe(42);
    });

    test('returns null for missing child path', () => {
      setCached('test/obj2', { a: 1 });
      expect(getSubkey('test/obj2', 'b/c')).toBeNull();
    });

    test('returns null when intermediate path is not an object', () => {
      setCached('test/obj3', { a: 'string' });
      expect(getSubkey('test/obj3', 'a/b')).toBeNull();
    });

    test('returns undefined after expiry', async () => {
      jest.useFakeTimers();
      setCached('test/subexpire', { x: 1 });
      jest.advanceTimersByTime(31000);
      expect(getSubkey('test/subexpire', 'x')).toBeUndefined();
      jest.useRealTimers();
    });
  });

  describe('bustPrefix', () => {
    test('removes all keys with matching prefix', () => {
      setCached('config/a', 1);
      setCached('config/b', 2);
      setCached('matches/c', 3);

      bustPrefix('config');

      expect(getCached('config/a')).toBeUndefined();
      expect(getCached('config/b')).toBeUndefined();
      expect(getCached('matches/c')).toBe(3);
    });

    test('removes exact prefix key', () => {
      setCached('players', [1, 2, 3]);
      bustPrefix('players');
      expect(getCached('players')).toBeUndefined();
    });

    test('increments generation on bust', () => {
      const before = getGeneration('test');
      bustPrefix('test');
      expect(getGeneration('test')).toBe(before + 1);
    });
  });

  describe('getGeneration', () => {
    test('returns 0 for key with no busts', () => {
      expect(getGeneration('neverbusted')).toBe(0);
    });

    test('returns correct generation for subkey', () => {
      bustPrefix('test');
      const gen = getGeneration('test/subkey');
      expect(gen).toBeGreaterThan(0);
    });
  });

  describe('TTL behavior', () => {
    test('config keys have 5-min TTL', () => {
      jest.useFakeTimers();
      setCached('config', { name: 'World Cup' });
      jest.advanceTimersByTime(4 * 60 * 1000);
      expect(getCached('config')).toEqual({ name: 'World Cup' });
      jest.advanceTimersByTime(2 * 60 * 1000);
      expect(getCached('config')).toBeUndefined();
      jest.useRealTimers();
    });

    test('votes keys have 30s TTL', () => {
      jest.useFakeTimers();
      setCached('votes/match1', { u1: 'Brazil' });
      jest.advanceTimersByTime(29000);
      expect(getCached('votes/match1')).toEqual({ u1: 'Brazil' });
      jest.advanceTimersByTime(2000);
      expect(getCached('votes/match1')).toBeUndefined();
      jest.useRealTimers();
    });
  });
});
