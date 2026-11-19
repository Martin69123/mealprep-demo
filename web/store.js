// Single JSON document in localStorage. Local only. Shape, migrations and validation live in
// ../core/state.js; this file only reads and writes.
import { freshState, parseState } from '../core/state.js';

const KEY = 'fitness-prototype-v1';
const RESCUE_KEY = 'fitness-prototype-rescue';

export { freshState };

/**
 * Loads the stored document. If something is stored but cannot be used, the raw text is copied to
 * a rescue slot BEFORE a fresh state is returned, so the next save cannot destroy it.
 * @returns {{ state: object, rescued: boolean }}
 */
export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch { /* storage blocked: run in memory */ }
  if (raw == null) return { state: freshState(), rescued: false };
  const result = parseState(raw);
  if (result.ok) return { state: result.state, rescued: false };
  try {
    localStorage.setItem(RESCUE_KEY, raw);
  } catch { /* nothing more we can do; the original key is still untouched until the next save */ }
  return { state: freshState(), rescued: true };
}

/** Returns false if the browser refused the write (quota, private mode). */
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Unreadable data set aside by load(), or null. */
export function rescued() {
  try {
    return localStorage.getItem(RESCUE_KEY);
  } catch {
    return null;
  }
}

export function clearRescued() {
  try {
    localStorage.removeItem(RESCUE_KEY);
  } catch { /* ignore */ }
}

export function clear() {
  localStorage.removeItem(KEY);
}

/** Parse an exported file; returns null when it is not a complete, consistent state document. */
export function parseImport(text) {
  const result = parseState(text);
  return result.ok ? result.state : null;
}
