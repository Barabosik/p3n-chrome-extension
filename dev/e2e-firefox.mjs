// The end-to-end checks in Firefox, on the Firefox build (dist/firefox, built first).
//   cd dev && npm run e2e:firefox        (FIREFOX=path/to/firefox to override; MOCK=1, ONLY= as in e2e.mjs)
// Firefox's automation can't open an extension page itself, so the test copy of the add-on opens its panel
// in a tab when installed, and the test drives that tab. MOCK=1 points the add-on at canned answers from the
// local test server instead of api.p3n.si (Firefox's automation can't intercept an extension's requests).
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { GUARDS, HEADLINES, SHORT, darkApplied, mock, oddAnswers, scoreSettled, selectField, selectFromLineBreak, selectNode, startServer } from './shared.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'out');
const FIREFOX = process.env.FIREFOX || { linux: '/usr/bin/firefox', darwin: '/Applications/Firefox.app/Contents/MacOS/firefox' }[process.platform] || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const MOCK = !!process.env.MOCK;
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync(process.execPath, [path.join(import.meta.dirname, 'build.mjs')], { stdio: 'ignore' });
const { server, base } = await startServer({ api: MOCK });

// ---- test copy of the Firefox build ---------------------------------------------------------
const ext = await mkdtemp(path.join(os.tmpdir(), 'p3n-ff-'));
await cp(path.join(ROOT, 'dist', 'firefox'), ext, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');
await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (MOCK) {
  const api = path.join(ext, 'lib', 'api.js');
  await writeFile(api, (await readFile(api, 'utf8')).replace("export const API = 'https://api.p3n.si';", `export const API = '${base}';`));
}
await appendFile(path.join(ext, 'background.js'), `
browser.runtime.onMessage.addListener((m) => (m?.p3nTest === 'startJob' ? startJob(...m.args).then(() => true) : undefined));
browser.runtime.onInstalled.addListener(() => browser.tabs.create({ url: browser.runtime.getURL('ui/panel.html') }));
`);

// ---- browser ---------------------------------------------------------------------------------
await mkdir(OUT, { recursive: true });
// Pages prefer light here whatever the machine's theme, and dark in the second Firefox at the end.
const browser = await puppeteer.launch({ browser: 'firefox', executablePath: FIREFOX, headless: true, args: ['-remote-allow-system-access', '--width=1100', '--height=900'], extraPrefsFirefox: { 'layout.css.prefers-color-scheme.content-override': 1 } });
const errors = [];
try {
  ok('add-on installs', (await browser.installExtension(ext)) === manifest.browser_specific_settings.gecko.id, `Firefox ${(await browser.version()).split('/')[1]}`);

  // The panel tab the add-on opened.
  let panel;
  for (let i = 0; i < 40 && !panel; i++) {
    await wait(250);
    for (const p of await browser.pages()) if (await p.evaluate(() => location.protocol).catch(() => '') === 'moz-extension:') panel = p;
  }
  ok('panel page opens', !!panel);
  await panel.waitForFunction(() => document.querySelector('.brand img')?.complete, { polling: 100, timeout: 10000 });
  ok('light theme follows the browser', !(await panel.evaluate(darkApplied)));
  panel.on('console', (m) => { if (m.type() === 'error') errors.push(`panel: ${m.text()}`); });
  panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
  await panel.waitForFunction(() => document.querySelector('#quota')?.textContent, { polling: 100, timeout: 10000 });

  const api = await panel.evaluate(async () => ({
    menus: await Promise.all(['p3n', 'p3n-detect', 'p3n-humanize'].map((m) => browser.contextMenus.update(m, {}).then(() => true, () => false))),
    sidebar: typeof browser.sidebarAction?.open === 'function' && !browser.sidePanel,
    consent: (await browser.permissions.getAll()).data_collection ?? [],
  }));
  ok('context menus exist (p3n > Check for AI, Rewrite)', api.menus.every(Boolean), String(api.menus));
  ok('sidebar API used (no side panel in Firefox)', api.sidebar);
  ok('data collection declared and granted', api.consent.includes('websiteContent'), api.consent.join(', '));

  // Brings a tab to the front the way the browser's own tab switch does (privileged pages can't be raised by
  // the automation, and a background tab gets no animation frames).
  const activate = (tabId) => panel.evaluate((id) => browser.tabs.update(id, { active: true }), tabId);
  const panelTab = await panel.evaluate(async () => (await browser.tabs.getCurrent()).id);

  async function scenario({ name, url, skill, select, expectReplace }) {
    const tab = await browser.newPage();
    tab.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await tab.goto(base + url);
    const text = await tab.evaluate(select);
    // Firefox match patterns can't name a port, so find the tab by its full URL.
    const { tabId, windowId } = await panel.evaluate(async (u) => { const t = (await browser.tabs.query({})).find((x) => x.url === u); return { tabId: t.id, windowId: t.windowId }; }, base + url);

    await activate(panelTab);
    await panel.evaluate(() => document.querySelector('#result').replaceChildren());
    const t0 = Date.now();
    await panel.evaluate((s, info, t) => browser.runtime.sendMessage({ p3nTest: 'startJob', args: [s, info, t] }), skill, { selectionText: text, frameId: 0 }, { id: tabId, windowId });
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
    await wait(1300);
    if (!res.isError) ok(`${name}: score ends on the stated value`, await panel.evaluate(scoreSettled));
    // No panel screenshot: Firefox's automation can't capture extension pages.

    if (skill === 'humanize' && !res.isError) {
      ok(`${name}: Replace button ${expectReplace ? 'shown' : 'hidden'}`, res.hasReplace === expectReplace);
      if (expectReplace) {
        await activate(tabId); // as in real use, the page is the visible tab next to the sidebar
        await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
        await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000, polling: 100 }).catch(() => {});
        const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
        const status = await panel.evaluate(() => [...document.querySelectorAll('#result .note')].map((n) => n.textContent).join(' | '));
        ok(`${name}: Replace puts the rewrite on the page`, after.replace(/\s+/g, ' ').includes(res.rewrite.replace(/\s+/g, ' ').trim()), status.slice(0, 80));
        if (url === '/rich') {
          ok(`${name}: text around the selection is kept`, after.includes('Hi team,') && after.includes('Thanks'));
          ok(`${name}: no blank line added`, !/\n\s*\n/.test(after.trim()), JSON.stringify(after));
        }
        if (url === '/textarea') ok(`${name}: field holds exactly the rewrite`, after === res.rewrite, JSON.stringify(after));
        if (url === '/lines') ok(`${name}: the line break before the selection is kept`, after === `Intro line.\n${res.rewrite}`, JSON.stringify(after));
        // Undo is the page's own: check it brings the original back.
        await tab.keyboard.down('Control'); await tab.keyboard.press('z'); await tab.keyboard.up('Control');
        const undone = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
        ok(`${name}: Ctrl+Z in the page undoes it`, undone.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ').trim()), JSON.stringify(undone.slice(0, 60)));
        await tab.screenshot({ path: path.join(OUT, `firefox-page-${name}-after.png`) }).catch(() => {});
      }
    }
    await tab.close();
  }

  const only = process.env.ONLY?.split(',');
  const scenarios = [
    { name: 'article', url: '/static', skill: 'detect', select: selectNode('#box') },
    { name: 'textarea', url: '/textarea', skill: 'humanize', select: selectField, expectReplace: true },
    { name: 'email', url: '/rich', skill: 'humanize', select: selectNode('#box div:nth-child(2)'), expectReplace: true },
    // Canned answers only, so not in a live run.
    ...(MOCK ? [{ name: 'lines', url: '/lines', skill: 'humanize', select: selectFromLineBreak, expectReplace: true }] : []),
  ];
  for (const s of scenarios) if (!only || only.includes(s.name)) await scenario(s);

  // The rewrite headline for each kind of score. Canned answers only, so not in a live run.
  await activate(panelTab);
  if (MOCK && (!only || only.includes('headline'))) {
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
  }

  // Replace refuses when the page text changed after the selection was taken. Canned answers only.
  if (MOCK && (!only || only.includes('guard'))) {
    for (const [url, select, edit] of GUARDS) {
      const tab = await browser.newPage();
      tab.on('pageerror', (e) => errors.push(`guard: ${e.message}`));
      await tab.goto(base + url);
      const text = await tab.evaluate(select);
      const { tabId, windowId } = await panel.evaluate(async (u) => { const t = (await browser.tabs.query({})).find((x) => x.url === u); return { tabId: t.id, windowId: t.windowId }; }, base + url);
      await activate(panelTab);
      await panel.evaluate(() => document.querySelector('#result').replaceChildren());
      await panel.evaluate((info, t) => browser.runtime.sendMessage({ p3nTest: 'startJob', args: ['humanize', info, t] }), { selectionText: text, frameId: 0 }, { id: tabId, windowId });
      await panel.waitForFunction(() => [...document.querySelectorAll('#result button')].some((b) => b.textContent.startsWith('Replace')) && document.querySelector('#busy').hidden, { timeout: 15000, polling: 100 });
      const edited = await tab.evaluate(edit);
      await activate(tabId);
      await panel.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => b.textContent.startsWith('Replace')).click());
      await panel.waitForFunction(() => !document.querySelector('#result .note.small')?.hidden, { timeout: 10000, polling: 100 }).catch(() => {});
      const after = await tab.evaluate(() => { const b = document.querySelector('#box'); return b.value ?? b.innerText; });
      const status = await panel.evaluate(() => document.querySelector('#result .note.small')?.textContent ?? '');
      ok(`guard ${url}: Replace refused after the page changed, page kept`, after === edited && /changed/.test(status), status);
      await tab.close();
    }
  }

  // Errors and answers missing their fields. Canned answers only.
  if (MOCK && (!only || only.includes('odd'))) {
    await activate(panelTab);
    await oddAnswers(panel, ok);
  }

  // Too long without a key: refused before any call.
  await panel.evaluate(() => { const t = document.querySelector('#text'); t.value = 'word '.repeat(1200); t.dispatchEvent(new Event('input')); document.querySelector('#check').click(); });
  const longMsg = await panel.$eval('#result', (r) => r.innerText);
  ok('over 5,000 characters without a key: explained, no call', /5,000/.test(longMsg), longMsg.slice(0, 120));

  // Options: a wrong key is refused and not saved.
  await panel.evaluate(() => browser.runtime.openOptionsPage());
  let opts;
  for (let i = 0; i < 40 && !opts; i++) {
    await wait(250);
    for (const p of await browser.pages()) if ((await p.evaluate(() => location.pathname).catch(() => '')).endsWith('/ui/options.html')) opts = p;
  }
  // Newer Firefox refuses typed input on extension pages, so set the field and fire the event the page listens to.
  await opts.evaluate(() => { const k = document.querySelector('#key'); k.value = 'p3n_not_a_real_key'; k.dispatchEvent(new Event('input')); });
  await opts.waitForFunction(() => /accept|reach/.test(document.querySelector('#status').textContent), { timeout: 15000, polling: 100 }).catch(() => {});
  const optMsg = await opts.$eval('#status', (s) => s.textContent);
  const stored = await opts.evaluate(async () => (await browser.storage.local.get('apiKey')).apiKey ?? null);
  ok('options: a wrong key is refused and not saved', /doesn't accept/.test(optMsg) && stored === null, optMsg);

  if (MOCK) ok('every API call names the client (X-P3N-Client)', [...mock.clients].join() === `p3n-firefox/${manifest.version}`, [...mock.clients].join(', '));
  ok('no script errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  ok('run finished', false, e.message.split('\n')[0]);
} finally {
  await Promise.race([browser.close(), wait(5000)]);
  server.close();
}
// Dark follows the browser: a second Firefox whose pages prefer dark (its automation can't emulate the media
// feature on an extension page), with the panel the add-on opens on install.
if (!process.env.ONLY || process.env.ONLY.split(',').includes('dark')) {
  let dark;
  try {
    dark = await puppeteer.launch({ browser: 'firefox', executablePath: FIREFOX, headless: true, args: ['-remote-allow-system-access'], extraPrefsFirefox: { 'layout.css.prefers-color-scheme.content-override': 0 } });
    await dark.installExtension(ext);
    let page;
    for (let i = 0; i < 40 && !page; i++) {
      await wait(250);
      for (const p of await dark.pages()) if (await p.evaluate(() => location.protocol).catch(() => '') === 'moz-extension:') page = p;
    }
    await page?.waitForFunction(() => document.querySelector('.brand img')?.complete, { polling: 100, timeout: 10000 });
    ok('dark theme follows the browser', !!page && await page.evaluate(darkApplied));
  } catch (e) {
    ok('dark theme follows the browser', false, e.message.split('\n')[0]);
  } finally {
    if (dark) await Promise.race([dark.close(), wait(5000)]);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed (Firefox${MOCK ? ', mocked API' : ''}).`);
process.exit(failed.length ? 1 : 0);
