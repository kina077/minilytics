-- DomainToolBelt: page requests from Cloudflare-verified bots (Googlebot, Bingbot, GPTBot...), pulled hourly from the
-- zone's Cloudflare analytics. Bots don't run the tracker, so they never appear in events/sessions; this is the only
-- place they are counted. One row per site, UTC hour (ms), bot and page.
CREATE TABLE bot_hits (
  site_id TEXT NOT NULL,
  hour INTEGER NOT NULL,
  bot TEXT NOT NULL,
  category TEXT,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (site_id, hour, bot, path)
);
