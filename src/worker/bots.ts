// DomainToolBelt: verified bots. Crawlers don't run the tracker, so they are read from Cloudflare's analytics for the
// zone instead. Cloudflare only sets verifiedBotCategory when the request really came from that bot (checked by IP /
// reverse DNS), so a scraper sending a Googlebot user agent is not counted. Pulled hourly by the cron trigger.
import type { Env } from './env';

const HOUR = 3_600_000;

// Asset and API requests are not pages.
const NOT_PAGES = ['/_nuxt/%', '/api/%', '/v1/%', '/mcp%', '/cdn-cgi/%', '%.%'];

const NAMES: [RegExp, string][] = [
  [/Googlebot|Google-InspectionTool|Storebot-Google/i, 'Googlebot'],
  [/bingbot|BingPreview/i, 'Bingbot'],
  [/Amzn-SearchBot/i, 'Amazon SearchBot'],
  [/facebookexternalhit|meta-externalagent|meta-webindexer/i, 'Meta'],
];

/** Short bot name from a user agent: "...compatible; OAI-SearchBot/1.4; +https..." -> "OAI-SearchBot". */
export function botName(ua: string): string {
  for (const [re, name] of NAMES) if (re.test(ua)) return name;
  const m = ua.match(/([A-Za-z][\w.-]*(?:bot|crawler|spider|user|agent|hookshot|indexer|fetcher))\b/i);
  if (m) return m[1];
  return (ua.split(/[\s/;(]/)[0] || 'Unknown bot').slice(0, 60);
}

interface Row {
  count: number;
  dimensions: { clientRequestHTTPHost: string; userAgent: string; verifiedBotCategory: string; clientRequestPath: string };
}

/** Turns Cloudflare rows into bot_hits rows for known sites (host matched to the site's domain, www. ignored). */
export function toHits(rows: Row[], sites: { id: string; domain: string }[], hour: number) {
  const byDomain = new Map(sites.map((s) => [s.domain, s.id]));
  const out = new Map<string, { site_id: string; hour: number; bot: string; category: string; path: string; hits: number }>();
  for (const r of rows) {
    const d = r.dimensions;
    const siteId = byDomain.get(d.clientRequestHTTPHost.toLowerCase().replace(/^www\./, ''));
    if (!siteId) continue;
    const bot = botName(d.userAgent);
    const path = d.clientRequestPath.slice(0, 500);
    const key = `${siteId}\n${bot}\n${path}`;
    const prev = out.get(key);
    if (prev) prev.hits += r.count;
    else out.set(key, { site_id: siteId, hour, bot, category: d.verifiedBotCategory, path, hits: r.count });
  }
  return [...out.values()];
}

async function fetchHour(env: Env, zone: string, hour: number): Promise<Row[]> {
  const filter = {
    datetime_geq: new Date(hour).toISOString(),
    datetime_lt: new Date(hour + HOUR).toISOString(),
    verifiedBotCategory_neq: '',
    edgeResponseStatus_lt: 400,
    AND: NOT_PAGES.map((p) => ({ clientRequestPath_notlike: p })),
  };
  const query = `query($zone: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject) { viewer { zones(filter: {zoneTag: $zone}) {
    rows: httpRequestsAdaptiveGroups(limit: 10000, filter: $filter) { count dimensions { clientRequestHTTPHost userAgent verifiedBotCategory clientRequestPath } }
  } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { zone, filter } }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) throw new Error(`Cloudflare analytics: ${res.status} ${JSON.stringify(body.errors ?? '').slice(0, 300)}`);
  return body.data?.viewer?.zones?.[0]?.rows ?? [];
}

/** Cron: (re)load the last two full hours, so late-arriving analytics are picked up. Rewriting an hour is idempotent. */
export async function syncBots(env: Env, now = Date.now()) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return;
  const sites = (await env.DB.prepare('SELECT id, domain FROM sites').all<{ id: string; domain: string }>()).results;
  const last = Math.floor(now / HOUR) * HOUR - HOUR;
  for (const hour of [last - HOUR, last]) {
    const hits = toHits(await fetchHour(env, env.CF_ZONE_ID, hour), sites, hour);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM bot_hits WHERE hour = ?').bind(hour),
      ...hits.map((h) =>
        env.DB.prepare('INSERT INTO bot_hits (site_id, hour, bot, category, path, hits) VALUES (?, ?, ?, ?, ?, ?)').bind(
          h.site_id, h.hour, h.bot, h.category, h.path, h.hits,
        ),
      ),
    ]);
  }
}

/** Bots in the period: page requests ("visits") and distinct pages per bot. */
export async function botStats(env: Env, siteId: string, from: number, to: number) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return { configured: false, bots: [] };
  const r = await env.DB.prepare(
    `SELECT bot, MAX(category) AS category, SUM(hits) AS visits, COUNT(DISTINCT path) AS pages
     FROM bot_hits WHERE site_id = ? AND hour >= ? AND hour < ? GROUP BY bot ORDER BY visits DESC LIMIT 100`,
  )
    .bind(siteId, from, to)
    .all<{ bot: string; category: string | null; visits: number; pages: number }>();
  return { configured: true, bots: r.results };
}
