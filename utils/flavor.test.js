import { jest } from '@jest/globals';

jest.unstable_mockModule('./firebase.js', () => ({
  readFlavor: jest.fn(),
}));

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { readFlavor } = await import('./firebase.js');
const { pickLine } = await import('./flavor.js');

beforeEach(() => jest.clearAllMocks());

describe('pickLine', () => {
  test('returns a line from the flavor array for the given key', async () => {
    readFlavor.mockResolvedValue({ welcome: ['Hello!', 'Hey there!', 'Howdy!'] });
    const result = await pickLine('welcome');
    expect(['Hello!', 'Hey there!', 'Howdy!']).toContain(result);
  });

  test('returns empty string when key does not exist', async () => {
    readFlavor.mockResolvedValue({ other: ['line'] });
    expect(await pickLine('missing')).toBe('');
  });

  test('returns empty string when key maps to empty array', async () => {
    readFlavor.mockResolvedValue({ empty: [] });
    expect(await pickLine('empty')).toBe('');
  });

  test('returns empty string when key maps to non-array value', async () => {
    readFlavor.mockResolvedValue({ bad: 'not an array' });
    expect(await pickLine('bad')).toBe('');
  });

  test('returns empty string when readFlavor throws', async () => {
    readFlavor.mockRejectedValue(new Error('db error'));
    expect(await pickLine('welcome')).toBe('');
  });

  test('returns the single line when array has one element', async () => {
    readFlavor.mockResolvedValue({ solo: ['only line'] });
    expect(await pickLine('solo')).toBe('only line');
  });
});
