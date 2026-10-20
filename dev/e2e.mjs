// End-to-end check in a throwaway Chrome profile, against the live API (uses 4 keyless calls).
//   cd dev && npm install && npm run e2e        (CHROME=path/to/chrome to override)
// A script can't click Chrome's own right-click menu, so it loads a dev copy of the extension that
// also has host access to the local test server, and starts the same startJob the menu does, by message.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'out');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AI_TEXT = "In today's fast-paced world, it's worth noting that effective communication is more important than ever. Moreover, leveraging the right tools can help teams unlock their full potential and navigate the complexities of modern work.";
const SHORT = 'Moreover, this seamless solution unlocks a rich tapestry of possibilities for teams of all sizes.';

// MOCK=1 answers the panel's API calls with these canned runs instead (no keyless calls used).
const MOCK = !!process.env.MOCK;
const FIXTURES = {
  detect: { id: 'mock-detect', skill: 'detect', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    output: { version: 'detect-v1.2', ai: 0.96, label: 'ai', verdict: 'Generic filler phrases with no specific claim or example.', confidence: { level: 'medium', reason: 'Two short sentences.' },
      sentences: [{ text: AI_TEXT.split('. ')[0] + '.', why: 'A stock opening with a vague claim.' }], examples: [] } },
  humanize: { id: 'mock-humanize', skill: 'humanize', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    // The live API ends the rewrite with a line break; the panel must not carry it into the page.
    output: { version: 'humanize-v1.1', model: 'haiku', text: 'It works for teams of all sizes.\n', ai_before: 0.08, ai_after: 0.02, label_after: 'human', passes: true, invented_blocked: [] } },
};

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ---- dev copy of the extension --------------------------------------------------------------
const ext = await mkdtemp(path.join(os.tmpdir(), 'p3n-ext-'));
await cp(ROOT, ext, { recursive: true, filter: (src) => !/^[\\/]?(dev|\.git|\.claude|node_modules)([\\/]|$)/.test(path.relative(ROOT, src)) });
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');
await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));
// The test starts jobs with a message from an extension page: that wakes the service worker if
// Chrome has put it to sleep, the way a real menu click does.
await appendFile(path.join(ext, 'background.js'), `
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m?.p3nTest !== 'startJob') return;
  startJob(...m.args).then(() => reply(true));
  return true;
});
`);

// ---- test pages ------------------------------------------------------------------------------
const page = (body) => `<!doctype html><meta charset="utf-8"><title>p3n test</title>
<style>body{font:16px/1.6 system-ui;max-width:640px;margin:40px auto;padding:0 20px;color:#222}textarea,[contenteditable]{width:100%;min-height:140px;font:inherit;padding:10px;border:1px solid #bbb;border-radius:6px}</style>${body}`;
const PAGES = {
  '/textarea': page(`<h1>Compose</h1><textarea id="box">${SHORT}</textarea>`),
  '/rich': page(`<h1>Email</h1><div id="box" contenteditable="true"><div>Hi team,</div><div>${SHORT}</div><div>Thanks</div></div>`),
  '/static': page(`<h1>Blog post</h1><article><p id="box">${AI_TEXT}</p></article>`),
};
const server = http.createServer((req, res) => { res.writeHead(PAGES[req.url] ? 200 : 404, { 'Content-Type': 'text/html' }); res.end(PAGES[req.url] ?? 'not found'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- browser ---------------------------------------------------------------------------------
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, args: ['--window-size=1280,900', '--lang=en-US'] });
const errors = [];
try {
  const id = await browser.installExtension(ext);
  ok('extension installs', !!id, id);
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`), { timeout: 15000 });
  const sw = await swTarget.worker();
  // onInstalled may still be creating the menus: ask a few times.
  let menus = [];
  for (let i = 0; i < 10 && !(menus.length && menus.every(Boolean)); i++) {
    if (i) await new Promise((r) => setTimeout(r, 300));
    menus = await sw.evaluate(async () => Promise.all(['p3n', 'p3n-detect', 'p3n-humanize'].map((m) => chrome.contextMenus.update(m, {}).then(() => true, () => false))));
  }
  ok('context menus exist (p3n > Check for AI, Rewrite)', menus.every(Boolean), String(menus));

  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    p.on('console', (m) => {
      const loc = m.location()?.url ?? '';
      // Expected: the test server has no favicon, and the options check sends a fake key on purpose (401).
      if (m.type() !== 'error' || loc.endsWith('/favicon.ico') || (name === 'options' && /401/.test(m.text()))) return;
      errors.push(`${name}: ${m.text()} ${loc}`);
    });
  };

  // A tab behind the panel paints no frames in headless Chrome, so its screenshot can wait forever.
  const shot = async (p, file) => { await p.bringToFront(); await p.screenshot({ path: path.join(OUT, file) }); };

  // The score counts to its value: true once the number on screen is the stated one and the bar is at rest.
  const scoreSettled = () => {
    const n = document.querySelector('.score .num');
    const sr = document.querySelector('.score .sr');
    return !!n && n.textContent === sr.textContent && !document.querySelector('.meter i')?.style.transform;
  };

  async function scenario({ name, url, skill, select, expectReplace, calm }) {
    const tab = await browser.newPage();
    watch(tab, name);
    await tab.setViewport({ width: 900, height: 800 });
    await tab.goto(base + url);
    const text = await tab.evaluate(select);

    const panel = await browser.newPage();
    watch(panel, `${name} panel`);
    await panel.setViewport({ width: 380, height: 900 });
    if (calm) await panel.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (MOCK) {
      await panel.setRequestInterception(true);
      panel.on('request', (r) => (r.url().startsWith('https://api.p3n.si/v1/')
        ? r.respond({ status: 200, contentType: 'application/json', headers: { 'X-Free-Remaining': '9' }, body: JSON.stringify(FIXTURES[skill]) })
        : r.continue()));
    }
    await panel.goto(`chrome-extension://${id}/ui/panel.html`);
    const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
    const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, base + url);

    const t0 = Date.now();
    await panel.evaluate((s, info, t) => chrome.runtime.sendMessage({ p3nTest: 'startJob', args: [s, info, t] }), skill, { selectionText: text, frameId: 0 }, { id: tabId, windowId });
    await panel.waitForFunction(() => document.querySelector('#result')?.textContent.trim().length > 0 && document.querySelector('#busy').hidden, { timeout: 120000, polling: 100 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const res = await panel.evaluate(() => ({
      text: document.querySelector('#text').value,
      result: document.querySelector('#result').innerText,
      isError: !!document.querySelector('#result .note.error'),
      hasReplace: [...document.querySelectorAll('#result button')].some((b) => b.textContent.startsWith('Replace')),
      rewrite: document.querySelector('#result .rewrite')?.textContent ?? null,
      quota: document.querySelector('#quota').textContent,
    }));
    ok(`${name}: selection reaches the panel`, res.text.replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim());
    ok(`${name}: ${skill} result shows`, !res.isError && res.result.length > 40, res.isError ? res.result.slice(0, 160) : `${secs} s, ${res.quota}`);
    if (calm && !res.isError) ok(`${name}: reduced motion shows the final score at once`, await panel.evaluate(scoreSettled));
    // FRAMES=1 keeps a few frames of the result arriving, to look at the motion.
    if (process.env.FRAMES) {
      for (const [i, ms] of [0, 120, 250, 400, 600, 900].entries()) {
        await new Promise((r) => setTimeout(r, i ? ms - [0, 120, 250, 400, 600, 900][i - 1] : 0));
        await panel.screenshot({ path: path.join(OUT, `frame-${name}-${i}.png`) });
      }
    }
    await new Promise((r) => setTimeout(r, 1300)); // let the result arrive and the score finish counting
    if (!res.isError) ok(`${name}: score ends on the stated value`, await panel.evaluate(scoreSettled));
    await panel.screenshot({ path: path.join(OUT, `panel-${name}.png`), fullPage: true });

    if (skill === 'humanize' && !res.isError) {
      ok(`${name}: Replace button ${expectReplace ? 'shown' : 'hidden'}`, res.hasReplace === expectReplace);
      if (expectReplace) {
        await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
        await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000 }).catch(() => {});
        const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
        const status = await panel.evaluate(() => [...document.querySelectorAll('#result .note')].map((n) => n.textContent).join(' | '));
        await new Promise((r) => setTimeout(r, 500)); // the check mark draws
        await panel.screenshot({ path: path.join(OUT, `panel-${name}-replaced.png`), fullPage: true });
        ok(`${name}: Replace puts the rewrite on the page`, after.replace(/\s+/g, ' ').includes(res.rewrite.replace(/\s+/g, ' ').trim()), status);
        if (url === '/rich') {
          ok(`${name}: text around the selection is kept`, after.includes('Hi team,') && after.includes('Thanks'));
          ok(`${name}: no blank line added`, !/\n\s*\n/.test(after.trim()), JSON.stringify(after));
        }
        if (url === '/textarea') ok(`${name}: field holds exactly the rewrite`, after === res.rewrite, JSON.stringify(after));
        await shot(tab, `page-${name}-after.png`);
      }
      if (expectReplace && url === '/textarea') {
        // Text edited in the panel is no longer the page's selection, so Replace mustn't be offered for it.
        await panel.bringToFront(); // a background tab gets no animation frames in headless Chrome
        await panel.evaluate((t) => { const el = document.querySelector('#text'); el.value = t; el.dispatchEvent(new Event('input')); document.querySelector('#rewrite').click(); }, `${text} We ship it in two weeks.`);
        await panel.waitForFunction(() => document.querySelector('#result')?.textContent.trim().length > 0 && document.querySelector('#busy').hidden, { timeout: 120000, polling: 100 });
        const edited = await panel.evaluate(() => ({ err: !!document.querySelector('#result .note.error'), replace: [...document.querySelectorAll('#result button')].some((b) => b.textContent.startsWith('Replace')) }));
        ok(`${name}: no Replace for text edited in the panel`, !edited.err && !edited.replace);
      }
    }
    await shot(tab, `page-${name}.png`);
    // Chrome has one side panel per window: close this one so the next job isn't picked up by it.
    await panel.close();
    await tab.close();
    return res;
  }

  const selectField = () => { const b = document.querySelector('#box'); b.focus(); b.setSelectionRange(0, b.value.length); return b.value; };
  const selectNode = (sel) => new Function(`const n = document.querySelector(${JSON.stringify(sel)}); const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.closest('[contenteditable]')?.focus(); return s.toString();`);

  // ONLY=email (comma-separated) runs a subset, to save keyless calls.
  const only = process.env.ONLY?.split(',');
  const scenarios = [
    { name: 'article', url: '/static', skill: 'detect', select: selectNode('#box') },
    { name: 'textarea', url: '/textarea', skill: 'humanize', select: selectField, expectReplace: true },
    { name: 'email', url: '/rich', skill: 'humanize', select: selectNode('#box div:nth-child(2)'), expectReplace: true, calm: true },
  ];
  for (const s of scenarios) if (!only || only.includes(s.name)) await scenario(s);

  // Too long without a key: refused before any call.
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 700 });
  await panel.goto(`chrome-extension://${id}/ui/panel.html`);
  await panel.evaluate(() => { const t = document.querySelector('#text'); t.value = 'word '.repeat(1200); t.dispatchEvent(new Event('input')); document.querySelector('#check').click(); });
  const longMsg = await panel.$eval('#result', (r) => r.innerText);
  ok('over 5,000 characters without a key: explained, no call', /5,000/.test(longMsg), longMsg.slice(0, 120));

  const opts = await browser.newPage();
  watch(opts, 'options');
  await opts.setViewport({ width: 760, height: 640 });
  await opts.goto(`chrome-extension://${id}/ui/options.html`);
  await opts.type('#key', 'p3n_not_a_real_key');
  await opts.waitForFunction(() => /accept|reach/.test(document.querySelector('#status').textContent), { timeout: 15000 }).catch(() => {});
  const optMsg = await opts.$eval('#status', (s) => s.textContent);
  // Read from the page, not the service worker: Chrome may have put the worker to sleep by now.
  const stored = await opts.evaluate(async () => (await chrome.storage.local.get('apiKey')).apiKey ?? null);
  ok('options: a wrong key is refused and not saved', /doesn't accept/.test(optMsg) && stored === null, optMsg);
  await opts.screenshot({ path: path.join(OUT, 'options.png') });

  ok('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} finally {
  // browser.close() can stall after a failure; don't let it hang the run.
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  server.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in dev/out/.`);
process.exit(failed.length ? 1 : 0);
