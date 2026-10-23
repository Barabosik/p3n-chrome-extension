// End-to-end check in a throwaway Chrome profile, against the live API (uses 4 keyless calls).
//   cd dev && npm install && npm run e2e        (CHROME=path/to/chrome to override)
// A script can't click Chrome's own right-click menu, so it loads a dev copy of the extension that
// also has host access to the local test server, and starts the same startJob the menu does, by message.
import puppeteer from 'puppeteer-core';
import { DOCS_PAGE, DOCS_URL, FIXTURES, GUARDS, HEADLINES, NOUNDO, SHORT, darkApplied, footFits, footLayout, lightApplied, mock, oddAnswers, reply, scoreSettled, selectField, selectFromLineBreak, selectNode, siteLink, siteLinkRight, startServer, systemLabels } from './shared.mjs';
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
// The stand-in Docs page (shared.mjs): the access a click on p3n in that tab gives.
manifest.host_permissions.push('https://docs.google.com/*');
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
// CI runners and containers have no usable Chrome sandbox. p3n.si itself doesn't resolve here, so the tab the panel's
// link opens never loads the site.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, args: ['--window-size=1280,900', '--lang=en-US', '--host-resolver-rules=MAP p3n.si ~NOTFOUND', ...(process.env.CI ? ['--no-sandbox'] : [])] });
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
      if (r.url().endsWith('/v1/me')) return r.respond({ status: 401, contentType: 'application/json', body: JSON.stringify(FIXTURES.me) });
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
      if (url === '/textarea') ok(`${name}: the footnote says "The rewrite", not Humanize`, /The rewrite drops filler/.test(res.result) && !/Humanize/.test(res.result));
      if (expectReplace) {
        await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
        await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000 }).catch(() => {});
        const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
        const status = await panel.evaluate(() => [...document.querySelectorAll('#result .note')].map((n) => n.textContent).join(' | '));
        await new Promise((r) => setTimeout(r, 500)); // the check mark draws
        await panel.screenshot({ path: path.join(OUT, `panel-${name}-replaced.png`), fullPage: true });
        ok(`${name}: Replace puts the rewrite on the page, and says Ctrl+Z undoes it`, after.replace(/\s+/g, ' ').includes(res.rewrite.replace(/\s+/g, ' ').trim()) && /Ctrl\+Z/.test(status), status);
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

  // An editor that refuses the browser's own edit: Replace still puts the rewrite in, doesn't promise Ctrl+Z, and
  // the original stays in the panel. Canned answers only.
  if (MOCK && (!only || only.includes('noundo'))) {
    for (const [url, select] of NOUNDO) {
      const tab = await browser.newPage();
      watch(tab, 'noundo');
      await tab.goto(base + url);
      const text = await tab.evaluate(select);
      const panel = await browser.newPage();
      watch(panel, 'noundo panel');
      await mockApi(panel);
      await panel.goto(`chrome-extension://${id}/ui/panel.html`);
      const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
      const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, base + url);
      await panel.evaluate((info, t) => chrome.runtime.sendMessage({ p3nTest: 'startJob', args: ['humanize', info, t] }), { selectionText: text, frameId: 0 }, { id: tabId, windowId });
      await panel.waitForFunction(() => [...document.querySelectorAll('#result button')].some((b) => b.textContent.startsWith('Replace')) && document.querySelector('#busy').hidden, { timeout: 15000, polling: 100 });
      await panel.evaluate((t) => chrome.scripting.executeScript({ target: { tabId: t }, func: () => { document.execCommand = () => false; } }), tabId);
      await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
      await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000, polling: 100 }).catch(() => {});
      const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
      const res = await panel.evaluate(() => ({ box: document.querySelector('#text').value, rewrite: document.querySelector('#result .rewrite').textContent, status: document.querySelector('#result .note.small')?.textContent ?? '' }));
      ok(`noundo ${url}: Replace puts the rewrite in, no Ctrl+Z promised, original kept in the panel`,
        after.replace(/\s+/g, ' ').includes(res.rewrite.replace(/\s+/g, ' ').trim()) && /can't undo/.test(res.status) && !/Ctrl\+Z/.test(res.status) && res.box.trim() === text.trim(), res.status);
      await panel.close();
      await tab.close();
    }
  }

  // Use selected text: the page's selection comes into the panel; with nothing selected it says so; and in Google
  // Docs (the stand-in at its address), which draws its own text, it says to paste instead. Canned answers only.
  if (MOCK && (!only || only.includes('grab'))) {
    const tab = await browser.newPage();
    watch(tab, 'grab');
    await tab.goto(`${base}/static`);
    const docs = await browser.newPage();
    watch(docs, 'grab docs');
    await docs.setRequestInterception(true);
    docs.on('request', (r) => (r.url().startsWith('https://docs.google.com/') ? r.respond({ status: 200, contentType: 'text/html', body: DOCS_PAGE }) : r.abort()));
    await docs.goto(DOCS_URL);
    const panel = await browser.newPage();
    watch(panel, 'grab panel');
    await panel.goto(`chrome-extension://${id}/ui/panel.html`);
    // With `page` in front, as the user sees it next to the panel.
    const grab = async (page) => {
      await page.bringToFront();
      await panel.evaluate(() => { document.querySelector('#text').value = ''; document.querySelector('#grab').click(); });
      await panel.waitForFunction(() => document.querySelector('#text').value || !document.querySelector('#hint').hidden, { timeout: 5000, polling: 100 }).catch(() => {});
      return panel.evaluate(() => ({ text: document.querySelector('#text').value, hint: document.querySelector('#hint').hidden ? '' : document.querySelector('#hint').textContent }));
    };
    const text = await tab.evaluate(selectNode('#box'));
    const got = await grab(tab);
    ok('grab: Use selected text brings the selection in', got.text.trim() === text.trim() && !got.hint, got.hint || got.text.slice(0, 40));
    await tab.evaluate(() => getSelection().removeAllRanges());
    const none = await grab(tab);
    ok('grab: nothing selected, says so', /^Nothing is selected/.test(none.hint) && !none.text, none.hint);
    const inDocs = await grab(docs);
    ok('grab: in Google Docs, says to copy and paste instead', inDocs.hint === "p3n can't read what you select in Google Docs. Copy the text and paste it in the box." && !inDocs.text, inDocs.hint);
    await panel.close();
    await docs.close();
    await tab.close();
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
  const keyCopy = await opts.$eval('main section p', (p) => p.textContent.replace(/\s+/g, ' '));
  ok('options: sign up at p3n.si, then create a key', /sign up at p3n\.si \(you get free credit\), then create a key on the API keys page/.test(keyCopy), keyCopy.slice(0, 120));
  const darkWhenLight = await opts.evaluate(darkApplied);
  await shot(opts, 'options.png');
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // A live switch: the logo's other source loads after the switch.
  const darkAfter = await opts.waitForFunction(darkApplied, { timeout: 5000, polling: 100 }).then(() => true, () => false);
  ok('options: light and dark themes follow the browser', !darkWhenLight && darkAfter);
  await shot(opts, 'options-dark.png');

  // System, Light or Dark (house rule: as in p3n.si's footer, nothing in the header): the icons at the panel's foot
  // and Appearance on the settings page. On a light browser: Dark at the foot turns the panel dark and keeps it, the
  // settings page follows, the choice shows from the first paint when the panel opens again; Light in the settings
  // holds on a dark browser; System follows the browser again.
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const pane = await browser.newPage();
  watch(pane, 'switch');
  await pane.setViewport({ width: 380, height: 640 });
  await pane.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  // The theme when <body> appears, before storage.local has answered.
  await pane.evaluateOnNewDocument(() => new MutationObserver((_, o) => { if (document.body) { window.firstTheme = document.documentElement.dataset.theme; o.disconnect(); } }).observe(document, { childList: true, subtree: true }));
  await pane.goto(`chrome-extension://${id}/ui/panel.html`);
  const theme = (p) => p.evaluate(async () => ({ stored: (await chrome.storage.local.get('theme')).theme ?? 'system', checked: [...document.querySelectorAll('[data-theme-set][aria-checked="true"]')].map((b) => b.dataset.themeSet).join() }));
  const turns = (p, dark) => p.waitForFunction(dark ? darkApplied : lightApplied, { timeout: 5000, polling: 100 }).then(() => true, () => false);
  // A DOM click: a page behind another paints no frames in headless Chrome.
  const press = (p, sel) => p.$eval(sel, (b) => b.click());
  const still = async (p, file) => { await p.bringToFront(); await new Promise((r) => setTimeout(r, 400)); await shot(p, file); };
  const foot = await pane.evaluate(() => {
    const pill = document.querySelector('footer [role="radiogroup"]');
    const r = pill?.getBoundingClientRect();
    return { header: !document.querySelector('header [data-theme-set], header [data-theme-toggle]'), buttons: pill?.querySelectorAll('[data-theme-set]').length, inView: !!r && r.right <= innerWidth && r.width > 0 };
  });
  ok('panel: System, Light and Dark at its foot, nothing in the header', foot.header && foot.buttons === 3 && foot.inView && (await theme(pane)).checked === 'system', JSON.stringify(foot));
  const labels = await pane.evaluate(systemLabels);
  ok('panel: the System icon is named "Match system theme", Light and Dark keep theirs', labels.system[0] === 'Match system theme' && labels.system[1] === 'Match system theme'
    && labels.light === 'Light' && labels.dark === 'Dark' && !!(await pane.$('::-p-aria([name="Match system theme"][role="radio"])')), JSON.stringify(labels));
  // In front: a page behind another doesn't update its accessibility tree in headless Chrome.
  await opts.bringToFront();
  const optLabels = await opts.evaluate(systemLabels);
  ok('options: System keeps its label, with "Match system theme" as its tooltip', optLabels.system[0] === null && optLabels.system[1] === 'Match system theme' && optLabels.system[2] === 'System'
    && optLabels.light === 'Light' && optLabels.dark === 'Dark' && !!(await opts.$('::-p-aria([name="System"][role="radio"])')), JSON.stringify(optLabels));
  await pane.bringToFront();
  // The link to p3n.si after the quota line, without a key (with one, in the odd answers); its name in the browser's
  // own accessibility tree is "p3n.si".
  const link = await pane.evaluate(siteLink);
  const named = await pane.$('::-p-aria([name="p3n.si"][role="link"])');
  ok('panel: a link to p3n.si after the quota line (new tab, noopener, named "p3n.si")', siteLinkRight(link) && !!named && await named.evaluate((a) => a.matches('footer a[href="https://p3n.si/"]')), JSON.stringify(link));
  await still(pane, 'panel-switch-light.png');
  await press(pane, 'footer [data-theme-set="dark"]');
  const t1 = await theme(pane);
  ok("panel: Dark turns a light browser's panel dark and keeps it", await turns(pane, true) && t1.stored === 'dark' && t1.checked === 'dark', JSON.stringify(t1));
  ok('options: follows the panel at once', await turns(opts, true) && (await theme(opts)).checked === 'dark');
  await still(pane, 'panel-switch-dark.png');
  await still(opts, 'options-switch-dark.png');
  await pane.reload();
  ok('panel: the choice holds when it opens again, from the first paint', await pane.evaluate(() => window.firstTheme) === 'dark' && await pane.evaluate(darkApplied));
  await press(opts, '[data-theme-set="light"]');
  await pane.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  ok('options: Light holds on a dark browser, and the panel follows', await turns(pane, false) && (await theme(pane)).checked === 'light');
  await still(opts, 'options-switch-light.png');
  await press(pane, 'footer [data-theme-set="system"]');
  ok('panel: System follows the browser again', await turns(pane, true) && (await theme(pane)).stored === 'system' && (await theme(opts)).checked === 'system');

  // The foot at a usual width and at the side panel's narrowest (a Firefox sidebar can be as narrow), with the longest
  // quota line (no free calls counted yet), in both themes: nothing past the edge, the icons in one row on the right.
  await pane.evaluate(() => chrome.storage.session.remove('free'));
  await pane.reload();
  await pane.waitForFunction(() => /^Free without a key/.test(document.querySelector('#quota').textContent), { timeout: 5000, polling: 100 }).catch(() => {});
  for (const width of [380, 300]) {
    await pane.setViewport({ width, height: 640 });
    const fits = [];
    for (const scheme of ['light', 'dark']) {
      await pane.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await turns(pane, scheme === 'dark');
      fits.push(await pane.evaluate(footLayout));
      await still(pane, `panel-foot-${width}-${scheme}.png`);
    }
    ok(`panel: the foot fits at ${width} px, light and dark`, fits.every(footFits) && /^Free without a key/.test(await pane.$eval('#quota', (q) => q.textContent)), JSON.stringify(fits[0]));
  }
  // A click opens p3n.si in a new tab and leaves the panel where it is (the tab fails to resolve, see the launch).
  await pane.bringToFront();
  const opened = browser.waitForTarget((t) => t.url() === 'https://p3n.si/', { timeout: 5000 }).catch(() => null);
  await pane.click('footer a[href="https://p3n.si/"]');
  const site = await opened;
  ok('panel: the link opens p3n.si in a new tab, not in the panel', site?.type() === 'page' && pane.url() === `chrome-extension://${id}/ui/panel.html`, site?.url() ?? 'no tab');
  await (await site?.page())?.close();
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
