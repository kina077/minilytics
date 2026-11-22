-- DomainToolBelt: session replays recorded on chosen pages (public/js/script.js data-replay). One row per recording,
-- its rrweb events in gzip chunks. Kept 7 days (cron in src/worker/replay.ts).
CREATE TABLE replays (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  path TEXT,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  chunks INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX replays_site_time ON replays (site_id, started_at);
CREATE TABLE replay_chunks (
  replay_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (replay_id, seq)
);
