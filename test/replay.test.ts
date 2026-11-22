import { describe, expect, it } from 'vitest';
import { clean, maskEmails } from '../src/replay/clean';

describe('replay masking', () => {
  it('hides emails in page text, keeps the rest', () => {
    expect(maskEmails('Signed in as jo.smith+x@mail.example.com today')).toBe('Signed in as ' + '*'.repeat(27) + ' today');
    expect(maskEmails('example.com is available')).toBe('example.com is available');
  });
  it('drops the query and hash from the recorded page URL', () => {
    const e = clean({ type: 4, data: { href: 'https://domaintoolbelt.com/login?token=secret#access_token=x', width: 1, height: 1 }, timestamp: 1 });
    expect(e.data.href).toBe('https://domaintoolbelt.com/login');
  });
  it('leaves other events alone', () => {
    const e = { type: 3, data: { source: 1, href: 'https://x.com/?a=1' }, timestamp: 1 };
    expect(clean(e).data.href).toBe('https://x.com/?a=1');
  });
});
