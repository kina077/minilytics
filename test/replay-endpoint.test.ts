import { Hono } from 'hono';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/worker/env';
import { handleReplay, listReplays, replayEvents } from '../src/worker/replay';

/** Just enough of D1: the site lookup, the replay size lookup, and the two writes. */
function fakeDb(siteBytes = 0) {
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
          if (sql.includes('SUM(bytes)')) return { b: siteBytes };
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

async function post(query: string, body: Uint8Array, origin = 'https://domaintoolbelt.com', siteBytes = 0) {
  const { db, writes } = fakeDb(siteBytes);
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
  it('starts no new replay once the site stores 300 MB', async () => {
    const full = await post(ok, chunk, 'https://domaintoolbelt.com', 301 * 1024 * 1024);
    expect(full.status).toBe(202);
    expect(full.writes).toEqual([]);
  });
});

describe('listReplays', () => {
  async function sqlOf(filters: object, vid?: string) {
    let seen = { sql: '', args: [] as unknown[] };
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({ all: async () => ((seen = { sql, args }), { results: [] }) }),
      }),
    } as unknown as D1Database;
    await listReplays(db, { id: 'site1' } as any, 10, 20, filters as any, vid);
    return seen;
  }
  it('applies the dashboard filters through the visit', async () => {
    const { sql, args } = await sqlOf({ country: 'DE', page: '/pricing' });
    expect(sql).toContain('s.country = ?');
    expect(args).toEqual(['site1', 10, 20, 'DE', '/pricing']);
  });
  it("lists one visitor's replays without the date range", async () => {
    const { sql, args } = await sqlOf({ country: 'DE' }, 'vid-12345678');
    expect(sql).not.toContain('s.country = ?');
    expect(args).toEqual(['site1', 'vid-12345678']);
  });
});

describe('replayEvents', () => {
  it('joins chunks from `from` on and says which chunk comes next', async () => {
    const rows = [
      { seq: 2, data: gzipSync('[{"type":3,"timestamp":2}]') },
      { seq: 3, data: new Uint8Array([1, 2, 3]) }, // broken chunk: skipped, still counted
    ];
    let bound: unknown[] = [];
    const db = {
      prepare: () => ({ bind: (...a: unknown[]) => ((bound = a), { all: async () => ({ results: rows.map((r) => ({ seq: r.seq, data: [...r.data] })) }) }) }),
    } as unknown as D1Database;
    const res = await replayEvents(db, { id: 'site1' } as any, 'rid-12345678', 2);
    expect(bound).toEqual(['rid-12345678', 'site1', 2]);
    expect(await res.json()).toEqual({ next: 4, events: [{ type: 3, timestamp: 2 }] });
  });
});
