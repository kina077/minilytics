export type Ev = { type: number; data: any; timestamp: number };

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export const maskEmails = (text: string) => text.replace(EMAIL, (m) => '*'.repeat(m.length));

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
