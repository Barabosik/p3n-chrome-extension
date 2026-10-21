// End-to-end check in a throwaway Chrome profile, against the live API (uses 4 keyless calls).
//   cd dev && npm install && npm run e2e        (CHROME=path/to/chrome to override)
// A script can't click Chrome's own right-click menu, so it loads a dev copy of the extension that
// also has host access to the local test server, and starts the same startJob the menu does, by message.
import puppeteer from 'puppeteer-core';
import { FIXTURES, GUARDS, HEADLINES, SHORT, darkApplied, lightApplied, mock, oddAnswers, reply, scoreSettled, selectField, selectFromLineBreak, selectNode, startServer } from './shared.mjs';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'out');
const CHROME = process.env.CHROME || { linux: '/usr/bin/google-chrome', darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MOCK = !!process.env.MOCK; // canned API runs (shared.mjs) instead of the live API
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ---- dev copy of the extension --------------------------------------------------------------
const ext = await mkdtemp(path.join(os.tmpdir(), 'p3n-ext-'));
await cp(ROOT, ext, { recursive: true, filter: (src) => !/^[\\/]?(dev|dist|store|\.git|\.claude|node_modules)([\\/]|$)/.test(path.relative(ROOT, src)) });
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
const { server, base } = await startServer();

// ---- browser ---------------------------------------------------------------------------------
await mkdir(OUT, { recursive: true });
// CI runners and containers have no usable Chrome sandbox.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, args: ['--window-size=1280,900', '--lang=en-US', ...(process.env.CI ? ['--no-sandbox'] : [])] });
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
  ok('side panel API present', await sw.evaluate(() => typeof chrome.sidePanel?.open === 'function'));

  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    p.on('console', (m) => {
      const loc = m.location()?.url ?? '';
      // Expected: the test server has no favicon, the options check sends a fake key on purpose (401), and the
      // odd answers are error statuses on purpose.
      if (m.type() !== 'error' || loc.endsWith('/favicon.ico') || (name === 'options' && /401/.test(m.text()))
        || (name === 'odd panel' && /Failed to load resource/.test(m.text()))) return;
      errors.push(`${name}: ${m.text()} ${loc}`);
    });
  };

  const mockApi = async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().startsWith('https://api.p3n.si/')) return r.continue();
      mock.clients.add(r.headers()['x-p3n-client'] ?? null);
      const a = reply(r.url().match(/\/v1\/(?:runs\/mock-)?(detect|humanize)$/)?.[1] ?? 'detect');
      if (a.drop) return r.abort('failed');
      r.respond({ status: a.status, contentType: a.type, headers: { 'X-Free-Remaining': '9' }, body: a.body });
    });
  };

  // A tab behind the panel paints no frames in headless Chrome, so its screenshot can wait forever.
  const shot = async (p, file) => { await p.bringToFront(); await p.screenshot({ path: path.join(OUT, file) }); };

  async function scenario({ name, url, skill, select, expectReplace, calm, dark }) {
    const tab = await browser.newPage();
    watch(tab, name);
    await tab.setViewport({ width: 900, height: 800 });
    await tab.goto(base + url);
    const text = await tab.evaluate(select);

    const panel = await browser.newPage();
    watch(panel, `${name} panel`);
    await panel.setViewport({ width: 380, height: 900 });
    // The theme is set either way, so the captures don't follow the machine's own (the store screenshots are light).
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, ...(calm ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [])]);
    if (MOCK) await mockApi(panel);
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
    ok(`${name}: ${dark ? 'dark' : 'light'} theme follows the browser`, await panel.evaluate(darkApplied) === !!dark);
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
        if (url === '/lines') ok(`${name}: the line break before the selection is kept`, after === `Intro line.\n${res.rewrite}`, JSON.stringify(after));
        await shot(tab, `page-${name}-after.png`);
        // Undo is the page's own: check it brings the original back.
        await tab.keyboard.down('Control'); await tab.keyboard.press('z'); await tab.keyboard.up('Control');
        const undone = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
        ok(`${name}: Ctrl+Z in the page undoes it`, undone.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ').trim()), JSON.stringify(undone.slice(0, 60)));
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


  // ONLY=email (comma-separated) runs a subset, to save keyless calls.
  const only = process.env.ONLY?.split(',');
  const scenarios = [
    { name: 'article', url: '/static', skill: 'detect', select: selectNode('#box') },
    { name: 'textarea', url: '/textarea', skill: 'humanize', select: selectField, expectReplace: true },
    { name: 'email', url: '/rich', skill: 'humanize', select: selectNode('#box div:nth-child(2)'), expectReplace: true, calm: true },
    // Canned answers only, so not in a live run. These two in dark (the store screenshots come from the light ones).
    ...(MOCK ? [
      { name: 'lines', url: '/lines', skill: 'humanize', select: selectFromLineBreak, expectReplace: true, dark: true },
      { name: 'article-dark', url: '/static', skill: 'detect', select: selectNode('#box'), dark: true },
    ] : []),
  ];
  for (const s of scenarios) if (!only || only.includes(s.name)) await scenario(s);

  // The rewrite headline for each kind of score. Canned answers only, so not in a live run.
  if (MOCK && (!only || only.includes('headline'))) {
    const panel = await browser.newPage();
    watch(panel, 'headline panel');
    await panel.setViewport({ width: 380, height: 900 });
    await mockApi(panel);
    await panel.goto(`chrome-extension://${id}/ui/panel.html`);
    for (const [i, [scores, want]] of HEADLINES.entries()) {
      mock.humanizeScores = scores;
      await panel.evaluate((t) => {
        document.querySelector('#result').replaceChildren();
        const el = document.querySelector('#text'); el.value = t; el.dispatchEvent(new Event('input')); document.querySelector('#rewrite').click();
      }, `${SHORT} Case ${i + 1}.`);
      await panel.waitForFunction(() => document.querySelector('#result .score .label') && document.querySelector('#busy').hidden, { timeout: 15000, polling: 100 });
      const label = await panel.$eval('#result .score .label', (n) => n.textContent);
      ok(`headline: "${want}" for ai_before ${scores.ai_before}, passes ${scores.passes}`, label === want, label);
    }
    mock.humanizeScores = null;
    await panel.close();
  }

  // Replace refuses when the page text changed after the selection was taken. Canned answers only.
  if (MOCK && (!only || only.includes('guard'))) {
    for (const [url, select, edit] of GUARDS) {
      const tab = await browser.newPage();
      watch(tab, 'guard');
      await tab.goto(base + url);
      const text = await tab.evaluate(select);
      const panel = await browser.newPage();
      watch(panel, 'guard panel');
      await mockApi(panel);
      await panel.goto(`chrome-extension://${id}/ui/panel.html`);
      const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
      const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, base + url);
      await panel.evaluate((info, t) => chrome.runtime.sendMessage({ p3nTest: 'startJob', args: ['humanize', info, t] }), { selectionText: text, frameId: 0 }, { id: tabId, windowId });
      await panel.waitForFunction(() => [...document.querySelectorAll('#result button')].some((b) => b.textContent.startsWith('Replace')) && document.querySelector('#busy').hidden, { timeout: 15000, polling: 100 });
      const edited = await tab.evaluate(edit);
      await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
      await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000, polling: 100 }).catch(() => {});
      const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
      const status = await panel.evaluate(() => document.querySelector('#result .note.small')?.textContent ?? '');
      ok(`guard ${url}: Replace refused after the page changed, page kept`, after === edited && /changed/.test(status), status);
      await panel.close();
      await tab.close();
    }
  }

  // Errors and answers missing their fields. Canned answers only.
  if (MOCK && (!only || only.includes('odd'))) {
    const panel = await browser.newPage();
    watch(panel, 'odd panel');
    await panel.setViewport({ width: 380, height: 900 });
    await mockApi(panel);
    await panel.goto(`chrome-extension://${id}/ui/panel.html`);
    await oddAnswers(panel, ok);
    await panel.close();
  }

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
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  if (MOCK) { // the key check too, so a mocked run makes no live call
    await opts.setRequestInterception(true);
    opts.on('request', (r) => {
      if (!r.url().startsWith('https://api.p3n.si/v1/')) return r.continue();
      mock.clients.add(r.headers()['x-p3n-client'] ?? null);
      return r.respond({ status: 401, contentType: 'application/json', body: JSON.stringify(FIXTURES.me) });
    });
  }
  await opts.goto(`chrome-extension://${id}/ui/options.html`);
  await opts.type('#key', 'p3n_not_a_real_key');
  await opts.waitForFunction(() => /accept|reach/.test(document.querySelector('#status').textContent), { timeout: 15000 }).catch(() => {});
  const optMsg = await opts.$eval('#status', (s) => s.textContent);
  // Read from the page, not the service worker: Chrome may have put the worker to sleep by now.
  const stored = await opts.evaluate(async () => (await chrome.storage.local.get('apiKey')).apiKey ?? null);
  ok('options: a wrong key is refused and not saved', /doesn't accept/.test(optMsg) && stored === null, optMsg);
  const darkWhenLight = await opts.evaluate(darkApplied);
  await shot(opts, 'options.png');
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // A live switch: the logo's other source loads after the switch.
  const darkAfter = await opts.waitForFunction(darkApplied, { timeout: 5000, polling: 100 }).then(() => true, () => false);
  ok('options: light and dark themes follow the browser', !darkWhenLight && darkAfter);
  await shot(opts, 'options-dark.png');

  // The sun/moon button, on a light browser: a click turns the panel dark and keeps it, the settings page follows,
  // the kept theme shows from the first paint when the panel opens again, and a second click keeps light, also on a
  // dark browser. The settings page has no theme control of its own.
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const pane = await browser.newPage();
  watch(pane, 'switch');
  await pane.setViewport({ width: 380, height: 640 });
  await pane.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  // The theme when <body> appears, before storage.local has answered.
  await pane.evaluateOnNewDocument(() => new MutationObserver((_, o) => { if (document.body) { window.firstTheme = document.documentElement.dataset.theme; o.disconnect(); } }).observe(document, { childList: true, subtree: true }));
  await pane.goto(`chrome-extension://${id}/ui/panel.html`);
  const theme = (p) => p.evaluate(async () => ({ kept: (await chrome.storage.local.get('theme')).theme ?? null, label: document.querySelector('[data-theme-toggle]')?.getAttribute('aria-label') }));
  const turns = (p, dark) => p.waitForFunction(dark ? darkApplied : lightApplied, { timeout: 5000, polling: 100 }).then(() => true, () => false);
  // A DOM click: a page behind another paints no frames in headless Chrome.
  const press = (p, sel) => p.$eval(sel, (b) => b.click());
  const still = async (p, file) => { await p.bringToFront(); await new Promise((r) => setTimeout(r, 400)); await shot(p, file); };
  const btn = await pane.$eval('header [data-theme-toggle]', (b) => { const r = b.getBoundingClientRect(); return r.width >= 32 && r.right <= innerWidth; });
  const t0 = await theme(pane);
  ok('panel: the sun/moon button is in the header, following the browser', btn && t0.label === 'Switch to dark theme' && t0.kept === null, JSON.stringify(t0));
  ok('options: no theme control of its own', await opts.evaluate(() => !document.querySelector('[data-theme-set], [role="radiogroup"]') && !/Appearance/.test(document.body.innerText)));
  await still(pane, 'panel-switch-light.png');
  await press(pane, '[data-theme-toggle]');
  const t1 = await theme(pane);
  ok("panel: a click turns a light browser's panel dark and keeps it", await turns(pane, true) && t1.kept === 'dark' && t1.label === 'Switch to light theme', JSON.stringify(t1));
  ok('options: follows the panel at once', await turns(opts, true));
  await still(pane, 'panel-switch-dark.png');
  await still(opts, 'options-switch-dark.png');
  await pane.reload();
  ok('panel: the kept theme shows when it opens again, from the first paint', await pane.evaluate(() => window.firstTheme) === 'dark' && await pane.evaluate(darkApplied));
  await pane.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await press(pane, '[data-theme-toggle]');
  const t2 = await theme(pane);
  ok('panel: a second click keeps light, also on a dark browser', await turns(pane, false) && await turns(opts, false) && t2.kept === 'light' && t2.label === 'Switch to dark theme', JSON.stringify(t2));
  await pane.evaluate(() => chrome.storage.local.remove('theme'));
  ok('panel: without a kept theme it follows the browser again', await turns(pane, true));
  await pane.close();

  if (MOCK) ok('every API call names the client (X-P3N-Client)', [...mock.clients].join() === `p3n-chrome/${manifest.version}`, [...mock.clients].join(', '));
  ok('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} finally {
  // browser.close() can stall after a failure; don't let it hang the run.
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  server.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in dev/out/.`);
process.exit(failed.length ? 1 : 0);
