/*! Minilytics session replay (DomainToolBelt). Loaded by public/js/script.js only on data-replay pages.
   Records with rrweb (MIT). Typed input and emails are masked in the browser; nothing is stored in cookies. */
import { record } from '@rrweb/record';
import { clean, maskEmails, resumeFrom, type Ev } from './clean';

const w = window as any;
const me = document.currentScript as HTMLScriptElement;
const site = me.getAttribute('data-website-id') || '';
const endpoint = me.getAttribute('data-api') || '';
const MAX_CHUNKS = 200; // the Worker refuses more anyway
const MAX_MS = 30 * 60_000;
// One replay per visit: sessionStorage keeps it across page loads in this tab and dies with the tab.
const KEY = 'ml_replay';

let stop: (() => void) | undefined;
let buf: Ev[] = [];
let rid = '';
let seq = 0;
let path = '';
let started = 0;

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

const ignored = () => {
  try {
    return localStorage.getItem('ml_ignore') === '1';
  } catch {
    return false;
  }
};

/** `end`: the visitor is leaving or hiding the page. */
function flush(end = false) {
  // The owner signed in mid-tab: drop what was recorded and stop.
  if (ignored()) {
    buf = [];
    stop?.();
    stop = undefined;
    return;
  }
  // Past the cap nothing more is sent, so stop buffering too (memory on long visits).
  if (seq >= MAX_CHUNKS) buf = [];
  // Marks when the page was left, so a visitor who only read (no taps, no scrolling) gets the real length, not 0s.
  else if (end && rid) buf.push({ type: 5, data: { tag: 'ml-leave', payload: {} }, timestamp: Date.now() });
  if (!buf.length || !rid) return;
  const ids = w.minilytics?.attribution?.() || {};
  if (!ids.ml_session_id) return;
  const events = buf;
  buf = [];
  const q = new URLSearchParams({ w: site, rid, seq: String(seq++), sid: ids.ml_session_id, vid: ids.ml_visitor_id, p: path });
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ sid: ids.ml_session_id, rid, seq, path }));
  } catch {}
  const json = JSON.stringify(events);
  // A closing page drops pending promises, so the last part can't wait for gzip: it goes as plain JSON now (the Worker packs it).
  const plain = new Blob([json], { type: 'text/plain' });
  if (end && plain.size < 60_000 && navigator.sendBeacon?.(endpoint + '?' + q, plain)) return;
  gzip(json)
    .then((body) =>
      fetch(endpoint + '?' + q, {
        method: 'POST',
        body,
        // keepalive lets the last chunk out when the tab closes, but browsers cap it at 64 KB.
        keepalive: body.size < 60_000,
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' },
      }),
    )
    .catch(() => {});
}

function start() {
  if (stop) return;
  let saved;
  try {
    saved = resumeFrom(sessionStorage.getItem(KEY), w.minilytics?.attribution?.()?.ml_session_id);
  } catch {}
  rid = saved ? saved.rid : crypto.randomUUID();
  seq = saved ? saved.seq : 0;
  path = saved ? saved.path : location.pathname;
  started = Date.now();
  stop = record({
    emit(e: Ev) {
      buf.push(clean(e));
      // Send the first full page right away, then every 30 s or 300 events.
      if (e.type === 2 || buf.length >= 300) flush();
      if (Date.now() - started > MAX_MS) toggle(false);
    },
    maskAllInputs: true,
    maskTextSelector: '*',
    maskTextFn: maskEmails,
    blockSelector: '[data-ml-block]',
    slimDOMOptions: 'all',
    sampling: { mousemove: 100, scroll: 150, input: 'last', media: 800 },
  });
}

/** Called by the tracker on every page change: record on replay pages, stop elsewhere. */
function toggle(on: boolean) {
  if (on) return start();
  if (!stop) return;
  stop();
  stop = undefined;
  flush(true);
  rid = '';
}

if (typeof CompressionStream === 'function' && site && endpoint) {
  w.__mlReplay = toggle;
  setInterval(() => flush(), 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
}
