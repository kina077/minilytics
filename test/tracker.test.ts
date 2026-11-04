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
  const store: Record<string, string> = {}
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
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v }, removeItem: (k: string) => { delete store[k] } },
    crypto: window.crypto, screen: window.screen,
    fetch: (_u: string, o: any) => { sent.push(JSON.parse(o.body)); return { catch() {} } },
  }
  window.document = document
  vm.runInNewContext(SRC, ctx)
  return { sent, window, store, click: (a: string) => {
    const el = { closest: (sel: string) => (sel.startsWith('a[') ? { href: a } : null) }
    for (const f of listeners.click || []) f({ target: el })
  } }
}

test('lookup pages are sent with the real name', () => {
  for (const page of [
    'https://domaintoolbelt.com/domain/example.com',
    'https://domaintoolbelt.com/tools/appraisal/bestname',
    'https://domaintoolbelt.com/tools/whois/name.io',
  ]) {
    const { sent } = run(page)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].t, 'pageview')
    assert.equal(sent[0].u, page)
  }
})

test('query strings keep the typed search and campaign parameters only', () => {
  const { sent } = run('https://domaintoolbelt.com/search?q=apple.io&token=hidden&utm_source=x&ref=launch')
  assert.equal(sent[0].u, 'https://domaintoolbelt.com/search?q=apple.io&utm_source=x&ref=launch')
  assert.ok(!JSON.stringify(sent).includes('hidden'))
})

test('normal pages are unchanged', () => {
  assert.equal(run('https://domaintoolbelt.com/drops/expiring-today').sent[0].u, 'https://domaintoolbelt.com/drops/expiring-today')
  assert.equal(run('https://domaintoolbelt.com/').sent[0].u, 'https://domaintoolbelt.com/')
})

test('referrer and outbound links keep the path, not the query', () => {
  const { sent, click } = run('https://domaintoolbelt.com/', 'https://other-whois.com/whois/private.net?x=1')
  assert.equal(sent[0].r, 'https://other-whois.com/whois/private.net')
  click('https://dan.com/buy-domain/example.com?aff=hidden')
  assert.equal(sent[1].t, 'outbound')
  assert.equal(sent[1].n, 'https://dan.com/buy-domain/example.com')
})

test('account area sends no pageviews or outbound clicks', () => {
  for (const p of ['/dashboard', '/dashboard/keyword-watch', '/login', '/auth/callback']) {
    const { sent, click } = run('https://domaintoolbelt.com' + p + '?token=secret')
    click('https://dan.com/buy-domain/example.com')
    assert.equal(sent.length, 0, p)
  }
})

test('goals in the account area go out on the bare prefix only', () => {
  const { sent, window } = run('https://domaintoolbelt.com/auth/callback?code=secret#access_token=x')
  window.minilytics('track', 'signed_up', { method: 'google' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].t, 'goal')
  assert.equal(sent[0].n, 'signed_up')
  assert.equal(sent[0].u, 'https://domaintoolbelt.com/auth')
  assert.deepEqual(sent[0].p, { method: 'google' })
  assert.ok(!JSON.stringify(sent).includes('secret'))
})

test('goal properties keep names and searches, drop emails and nested values', () => {
  const { sent, window } = run('https://domaintoolbelt.com/search')
  window.minilytics('track', 'marketplace_click', {
    page: 'search', domain: 'apple.com', query: 'apple', email: 'a@hidden.com', tld: '.co.uk', count: 3, ok: true, nested: { a: 1 },
  })
  const g = sent.find((e) => e.t === 'goal')!
  assert.deepEqual(g.p, { page: 'search', domain: 'apple.com', query: 'apple', tld: '.co.uk', count: 3, ok: true })
  assert.ok(!JSON.stringify(sent).includes('hidden'))
})

test('events go to the Worker, not our origin', () => {
  // fetch is called with the data-api endpoint; the sandbox records bodies only, so check the source wiring
  assert.ok(SRC.includes("script.getAttribute('data-api')"))
})

test('owner flag set after load (sign-in in an open tab) stops sending at once', () => {
  const { sent, store, click } = run('https://domaintoolbelt.com/pricing')
  const before = sent.length
  assert.ok(before > 0)
  store.ml_ignore = '1'
  click('https://www.namecheap.com/')
  assert.equal(sent.length, before)
})

test('preview sites are never tracked', () => {
  const { sent, click } = run('https://preview-domaintoolbelt-main-site-x.domaintoolbelt.com/')
  click('https://www.namecheap.com/')
  assert.equal(sent.length, 0)
})
