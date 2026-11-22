import type { Context } from 'hono';
import { siteOwnerActive } from './auth';
import { belongsTo, isId } from './collect';
import { getSite, type AppEnv, type Site } from './env';
import { isOwnerVisit } from './owner';
import { isBot } from './lib/ua';
import { filterSql, type Filters } from './stats';

const MAX_CHUNK = 512 * 1024;
const MAX_CHUNKS = 200;
// Gzip packs rrweb events ~10x, so 2 MB stored is ~20 MB of JSON when a replay is opened (Worker memory is 128 MB).
const MAX_REPLAY = 2 * 1024 * 1024;
// Replays share the stats database (500 MB on the free plan): stop starting new ones past 300 MB.
const MAX_SITE = 300 * 1024 * 1024;
export const KEEP_MS = 7 * 86_400_000;

/** POST /r?w&rid&seq&sid&vid&p, body = one gzip chunk of rrweb events (js/replay.js). */
export async function handleReplay(c: Context<AppEnv>) {
  const q = c.req.query();
  const seq = Number(q.seq);
  if (![q.w, q.rid, q.sid, q.vid].every(isId) || !Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) return c.body(null, 400);
  if (isBot(c.req.header('user-agent') ?? '')) return c.body(null, 202);

  const site = await getSite(c.env.DB, q.w);
  if (!site) return c.body(null, 404);
  if (!siteOwnerActive(c.env, site)) return c.body(null, 202);
  // Browsers always send Origin on a cross-site POST: only the site's own pages may record.
  let origin: URL;
  try {
    origin = new URL(c.req.header('origin') ?? '');
  } catch {
    return c.body(null, 403);
  }
  if (!belongsTo(origin.hostname, site.domain)) return c.body(null, 403);

  const data = await c.req.arrayBuffer();
  // Every chunk is gzip (magic 1f 8b), so the dashboard can always unpack what is stored.
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (data.byteLength > MAX_CHUNK) return c.body(null, 413);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return c.body(null, 400);
  if (await isOwnerVisit(c, site)) return c.body(null, 202);

  const db = c.env.DB;
  const prev = await db.prepare('SELECT site_id, bytes FROM replays WHERE id = ?').bind(q.rid).first<{ site_id: string; bytes: number }>();
  if (prev && (prev.site_id !== site.id || prev.bytes + data.byteLength > MAX_REPLAY)) return c.body(null, 202);
  if (!prev) {
    const total = await db.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM replays WHERE site_id = ?').bind(site.id).first<{ b: number }>();
    if ((total?.b ?? 0) > MAX_SITE) return c.body(null, 202);
  }

  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO replays (id, site_id, session_id, visitor_id, path, started_at, last_at, chunks, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (id) DO UPDATE SET last_at = excluded.last_at, chunks = chunks + 1, bytes = bytes + excluded.bytes`,
      )
      .bind(q.rid, site.id, q.sid, q.vid, (q.p ?? '').slice(0, 500) || null, now, now, data.byteLength),
    db.prepare('INSERT OR IGNORE INTO replay_chunks (replay_id, seq, data) VALUES (?, ?, ?)').bind(q.rid, seq, data),
  ]);
  return c.body(null, 202);
}

/** Recordings that started in the period and match the dashboard filters, newest first; or all of one visitor's. */
export async function listReplays(db: D1Database, site: Site, from: number, to: number, filters: Filters, vid?: string) {
  const f = vid ? { sql: ' AND r.visitor_id = ?', params: [vid] } : filterSql(filters);
  const r = await db
    .prepare(
      `SELECT r.id, r.session_id, r.path, r.started_at, r.last_at, r.bytes, r.visitor_id, s.country, s.browser, s.os, s.device
       FROM replays r LEFT JOIN sessions s ON s.site_id = r.site_id AND s.id = r.session_id
       WHERE r.site_id = ?${vid ? '' : ' AND r.started_at >= ? AND r.started_at < ?'}${f.sql} ORDER BY r.started_at DESC LIMIT 200`,
    )
    .bind(site.id, ...(vid ? [] : [from, to]), ...f.params)
    .all();
  return r.results;
}

/** All events of one recording, as one JSON array. */
export async function replayEvents(db: D1Database, site: Site, id: string): Promise<Response> {
  const r = await db
    .prepare('SELECT c.data FROM replay_chunks c JOIN replays r ON r.id = c.replay_id WHERE r.id = ? AND r.site_id = ? ORDER BY c.seq')
    .bind(id, site.id)
    .all<{ data: ArrayBuffer | number[] }>();
  const parts: string[] = [];
  for (const row of r.results) {
    const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
    try {
      const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      JSON.parse(text); // a broken chunk is skipped, not passed on to break the whole replay
      const inner = text.trim().slice(1, -1); // each chunk is a JSON array
      if (inner) parts.push(inner);
    } catch {}
  }
  return new Response('[' + parts.join(',') + ']', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Hourly: drop recordings older than 7 days. */
export async function pruneReplays(db: D1Database, now = Date.now()) {
  const cut = now - KEEP_MS;
  await db.batch([
    db.prepare('DELETE FROM replay_chunks WHERE replay_id IN (SELECT id FROM replays WHERE started_at < ?)').bind(cut),
    db.prepare('DELETE FROM replays WHERE started_at < ?').bind(cut),
  ]);
}
