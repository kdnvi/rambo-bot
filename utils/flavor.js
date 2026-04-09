import { readFlavor } from './firebase.js';
import logger from './logger.js';

export async function pickLine(key) {
  try {
    const all = await readFlavor();
    const lines = all[key];
    if (Array.isArray(lines) && lines.length > 0) {
      return lines[Math.floor(Math.random() * lines.length)];
    }
  } catch (err) {
    logger.error(`Failed to read flavor key [${key}]:`, err);
  }
  return '';
}
