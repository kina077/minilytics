export type Ev = { type: number; data: any; timestamp: number };

// Emails, DomainToolBelt API keys (dtb_live_...) and card-number-like digit runs (13-19 digits).
const SECRET = /[\w.+-]+@[\w-]+(\.[\w-]+)+|dtb_live_\w+|\b\d(?:[ -]?\d){12,18}\b/g;

export const maskText = (text: string) => text.replace(SECRET, (m) => '*'.repeat(m.length));

/** Replay path: the API console host (console.<site>) is filed under /console so it never reads as the home page. */
export const replayPath = (host: string, path: string) => (/^console\./.test(host) ? '/console' + (path === '/' ? '' : path) : path);

/** Meta events carry the full URL: keep origin + path only, so tokens in ?query or #hash never leave. */
export function clean(e: Ev): Ev {
  if (e.type === 4 && e.data && typeof e.data.href === 'string') {
    try {
      const u = new URL(e.data.href);
      e.data.href = u.origin + u.pathname;
    } catch {
      e.data.href = '';
    }
  }
  return e;
}

export type Saved = { sid: string; rid: string; seq: number; path: string };

/** The recording this tab already sends for the visit, if the session is still the same: page loads add to it. */
export function resumeFrom(saved: string | null, sid: string | undefined): Saved | undefined {
  try {
    const s = JSON.parse(saved || 'null');
    if (s && sid && s.sid === sid && typeof s.rid === 'string' && Number.isInteger(s.seq)) return s;
  } catch {}
}
