/*! Minilytics session replay (DomainToolBelt). Loaded by public/js/script.js only on data-replay pages.
   Records with rrweb (MIT). Typed input and emails are masked in the browser; nothing is stored in cookies. */
import { record } from '@rrweb/record';
import { clean, maskEmails, type Ev } from './clean';

const w = window as any;
const me = document.currentScript as HTMLScriptElement;
const site = me.getAttribute('data-website-id') || '';
const endpoint = me.getAttribute('data-api') || '';
const MAX_CHUNKS = 200; // the Worker refuses more anyway
const MAX_MS = 30 * 60_000;

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

function flush() {
  // The owner signed in mid-tab: drop what was recorded and stop.
  if (ignored()) {
    buf = [];
    stop?.();
    stop = undefined;
    return;
  }
  if (!buf.length || !rid || seq >= MAX_CHUNKS) return;
  const ids = w.minilytics?.attribution?.() || {};
  if (!ids.ml_session_id) return;
  const events = buf;
  buf = [];
  const q = new URLSearchParams({ w: site, rid, seq: String(seq++), sid: ids.ml_session_id, vid: ids.ml_visitor_id, p: path });
  gzip(JSON.stringify(events))
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
  rid = crypto.randomUUID();
  seq = 0;
  path = location.pathname;
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
  flush();
  rid = '';
}

if (typeof CompressionStream === 'function' && site && endpoint) {
  w.__mlReplay = toggle;
  setInterval(flush, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
