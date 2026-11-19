// The ONLY file in web/ that talks to a server, and only to this page's own local server
// (tools/serve.mjs), which passes the request to the Ollama runtime on this PC. A test checks that
// every call here uses a fixed path under /api/assistant/ and that no other file can connect at all.
import { checkContext, parseProposal } from '../core/assistant.js';

/** @returns {Promise<{ available: boolean, model?: string, reason?: string }>} never rejects */
export async function status() {
  // The assistant's server exists only on the PC. On a hosted copy (the phone) there is nothing to
  // ask, so do not send a request at all.
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return { available: false, reason: 'server' };
  try {
    const res = await fetch('/api/assistant/status', { cache: 'no-store' });
    return res.ok ? await res.json() : { available: false, reason: 'server' };
  } catch {
    return { available: false, reason: 'server' };
  }
}

/**
 * Ask the local model for proposed meals and validate the answer. Never rejects.
 * @param {import('../core/assistant.js').AssistantContext} ctx @param {AbortSignal} signal
 * @returns {Promise<{ ok: true, actions: object[], rejected: number, model: string, ms: number } | { ok: false, error: string }>}
 */
export async function propose(ctx, signal) {
  if (checkContext(ctx).length) return { ok: false, error: 'bad-request' };
  try {
    const res = await fetch('/api/assistant/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
      signal,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : 'server' };
    const parsed = parseProposal(data.raw, ctx);
    if (!parsed.ok) return { ok: false, error: 'bad-answer' };
    return { ok: true, actions: parsed.actions, rejected: parsed.rejected, model: String(data.model), ms: Number(data.ms) };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'cancelled' : 'server' };
  }
}
