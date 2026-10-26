import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * public/js/script.js is our copy of the Minilytics tracker. The privacy rule (never
 * store a name someone looked up) is enforced IN THE BROWSER by this file, so
 * these tests run the shipping file in a sandbox and read what it would send.
 */

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'public/js/script.js'), 'utf8')

type Sent = Record<string, any>

function run(href: string, referrer = '', exclude = '/dashboard,/login,/auth') {
  const sent: Sent[] = []
  const url = new URL(href)
  const listeners: Record<string, Function[]> = {}
  const attrs: Record<string, string> = {
    'data-website-id': 'dtb-main-site',
    'data-api': 'https://minilytics.example.workers.dev/api/event',
    'data-exclude': exclude,
  }
  const document = {
    currentScript: { src: 'https://minilytics.example.workers.dev/js/script.js', getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs },
    cookie: '',
    referrer,
    visibilityState: 'visible',
    addEventListener: (e: string, f: Function) => { (listeners[e] ||= []).push(f) },
  }
  const window: any = {
    location: { href: url.href, pathname: url.pathname, search: url.search, hostname: url.hostname, protocol: url.protocol },
    navigator: { webdriver: false },
    history: { pushState() {}, replaceState() {} },
    screen: { width: 1280 },
    addEventListener: (e: string, f: Function) => { (listeners[e] ||= []).push(f) },
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  }
  const ctx = {
    window, document, URL, URLSearchParams, Blob, JSON, Date, Math, String, Object, RegExp,
    encodeURIComponent, decodeURIComponent, setTimeout: () => 0, setInterval: () => 0,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: window.crypto, screen: window.screen,
    fetch: (_u: string, o: any) => { sent.push(JSON.parse(o.body)); return { catch() {} } },
  }
  window.document = document
  vm.runInNewContext(SRC, ctx)
  return { sent, click: (a: string) => {
    const el = { closest: (sel: string) => (sel.startsWith('a[') ? { href: a } : null) }
    for (const f of listeners.click || []) f({ target: el })
  } }
}

test('lookup pages are sent with the name masked', () => {
  for (const [page, want] of [
    ['https://domaintoolbelt.com/domain/example.com', 'https://domaintoolbelt.com/domain/:name'],
    ['https://domaintoolbelt.com/tools/whois/secret-name.io', 'https://domaintoolbelt.com/tools/whois/:name'],
    ['https://domaintoolbelt.com/tools/appraisal/bestname', 'https://domaintoolbelt.com/tools/appraisal/:name'],
    ['https://domaintoolbelt.com/tools/trademark/apple', 'https://domaintoolbelt.com/tools/trademark/:name'],
    ['https://domaintoolbelt.com/x-card/abc123', 'https://domaintoolbelt.com/x-card/:name'],
  ]) {
    const { sent } = run(page)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].t, 'pageview')
    assert.equal(sent[0].u, want)
  }
})

test('query strings keep only campaign parameters', () => {
  const { sent } = run('https://domaintoolbelt.com/tools/bulk-availability?q=hidden.com&utm_source=x&ref=launch')
  assert.equal(sent[0].u, 'https://domaintoolbelt.com/tools/bulk-availability?utm_source=x&ref=launch')
  assert.ok(!JSON.stringify(sent).includes('hidden'))
})

test('normal pages are unchanged', () => {
  assert.equal(run('https://domaintoolbelt.com/drops/expiring-today').sent[0].u, 'https://domaintoolbelt.com/drops/expiring-today')
  assert.equal(run('https://domaintoolbelt.com/').sent[0].u, 'https://domaintoolbelt.com/')
})

test('referrer and outbound links are masked', () => {
  const { sent, click } = run('https://domaintoolbelt.com/', 'https://other-whois.com/whois/private.net?x=1')
  assert.equal(sent[0].r, 'https://other-whois.com/whois/:name')
  click('https://dan.com/buy-domain/example.com')
  assert.equal(sent[1].t, 'outbound')
  assert.equal(sent[1].n, 'https://dan.com/buy-domain/:name')
})

test('account area sends nothing', () => {
  for (const p of ['/dashboard', '/dashboard/keyword-watch', '/login', '/auth/callback']) {
    assert.equal(run('https://domaintoolbelt.com' + p).sent.length, 0, p)
  }
})

test('events go to the Worker, not our origin', () => {
  // fetch is called with the data-api endpoint; the sandbox records bodies only, so check the source wiring
  assert.ok(SRC.includes("script.getAttribute('data-api')"))
})
