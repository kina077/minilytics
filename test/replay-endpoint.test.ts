import { Hono } from 'hono';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/worker/env';
import { handleReplay } from '../src/worker/replay';

/** Just enough of D1: the site lookup, the replay size lookup, and the two writes. */
function fakeDb() {
  const writes: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      const st = {
        args: [] as unknown[],
        bind(...a: unknown[]) {
          st.args = a;
          return st;
        },
        async first() {
          if (sql.includes('FROM sites')) return { id: 'test-site-1', domain: 'domaintoolbelt.com', owner_id: null };
          return null;
        },
        sql,
      };
      return st;
    },
    async batch(sts: { sql: string; args: unknown[] }[]) {
      for (const s of sts) writes.push([s.sql.trim().split(/\s+/).slice(0, 3).join(' '), ...s.args]);
    },
  };
  return { db: db as unknown as D1Database, writes };
}

async function post(query: string, body: Uint8Array, origin = 'https://domaintoolbelt.com') {
  const { db, writes } = fakeDb();
  const app = new Hono<AppEnv>().post('/r', handleReplay);
  const req = new Request('https://ml.domaintoolbelt.com/r?' + query, {
    method: 'POST',
    body: new Blob([body as BlobPart]),
    headers: { origin, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36' },
  });
  const res = await app.fetch(req, { DB: db } as any);
  return { status: res.status, writes };
}

const ok = 'w=test-site-1&rid=11111111-2222-4333-8444-555555555555&seq=0&sid=aaaaaaaa-bbbb&vid=cccccccc-dddd&p=/pricing';
const chunk = gzipSync('[{"type":4,"data":{},"timestamp":1}]');

describe('POST /r', () => {
  it('stores a gzip chunk from the site itself', async () => {
    const { status, writes } = await post(ok, chunk);
    expect(status).toBe(202);
    expect(writes.map((w) => w[0])).toEqual(['INSERT INTO replays', 'INSERT OR IGNORE']);
    expect(writes[0].slice(1, 6)).toEqual(['11111111-2222-4333-8444-555555555555', 'test-site-1', 'aaaaaaaa-bbbb', 'cccccccc-dddd', '/pricing']);
  });
  it('refuses other sites, bad ids, non-gzip bodies and too many chunks', async () => {
    expect((await post(ok, chunk, 'https://evil.example')).status).toBe(403);
    expect((await post(ok.replace('seq=0', 'seq=200'), chunk)).status).toBe(400);
    expect((await post(ok.replace('rid=11111111-2222-4333-8444-555555555555', 'rid=bad'), chunk)).status).toBe(400);
    const plain = await post(ok, new TextEncoder().encode('[]'));
    expect(plain.status).toBe(400);
    expect(plain.writes).toEqual([]);
  });
});
