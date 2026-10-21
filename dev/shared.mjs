// What the Chrome and Firefox end-to-end checks share: test texts, canned API runs, the local test server.
import http from 'node:http';

export const AI_TEXT = "In today's fast-paced world, it's worth noting that effective communication is more important than ever. Moreover, leveraging the right tools can help teams unlock their full potential and navigate the complexities of modern work.";
export const SHORT = 'Ultimately, this seamless transition unlocks a rich tapestry of possibilities for teams of all sizes, empowering everyone to thrive in an ever-evolving landscape.';

// MOCK=1 answers the panel's API calls with these canned runs instead (no keyless calls used).
export const FIXTURES = {
  detect: { id: 'mock-detect', skill: 'detect', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    output: { version: 'detect-v1.2', ai: 0.96, label: 'ai', verdict: 'Generic filler phrases with no specific claim or example.', confidence: { level: 'medium', reason: 'Two short sentences.' },
      sentences: [{ text: AI_TEXT.split('. ')[0] + '.', why: 'A stock opening with a vague claim.' }], examples: [] } },
  humanize: { id: 'mock-humanize', skill: 'humanize', status: 'succeeded', cached: false, error: null, charged_usd: '0',
    // The live API ends the rewrite with a line break; the panel must not carry it into the page.
    output: { version: 'humanize-v1.3', model: 'haiku', text: 'This transition helps teams of all sizes.\n', ai_before: 0.95, ai_after: 0.01, label_after: 'human', passes: true, invented_blocked: [] } },
  // /v1/me with any key (the options page's wrong-key check), sent with a 401.
  me: { error: { type: 'unauthorized', message: 'Invalid API key.' } },
};

// Scores laid over the humanize fixture while set, for the headline cases below. `queue` replaces the next
// answers in turn (the odd cases below), and `calls` counts the calls the stand-in API answered.
export const mock = { humanizeScores: null, queue: [], calls: 0 };
export const answer = (skill) => (skill === 'humanize' && mock.humanizeScores
  ? { ...FIXTURES.humanize, output: { ...FIXTURES.humanize.output, ...mock.humanizeScores } }
  : FIXTURES[skill]);

// The stand-in API's answer to a skill call or a run poll: { status, type, body }, or { drop } to cut the connection.
export function reply(skill) {
  mock.calls++;
  const n = mock.queue.shift();
  if (n?.drop) return { drop: true };
  if (n?.html) return { status: n.status, type: 'text/html', body: n.html };
  return { status: n?.status ?? 200, type: 'application/json', body: JSON.stringify(n ? n.body : answer(skill)) };
}

// Errors and answers missing their fields: the panel explains each one, with no script error.
export const ODD = [
  { name: 'free limit: own copy, Sign up only to p3n.si', skill: 'detect', want: /used up; more in about 10 min/, href: 'https://p3n.si/register',
    next: { status: 429, body: { error: { type: 'free_limit', message: 'Free calls are used up.', signup_url: 'javascript:alert(1)', retry_after_seconds: 600 } } } },
  { name: "504 too_long: the API's message", skill: 'humanize', want: /send a shorter text/,
    next: { status: 504, body: { error: { type: 'too_long', message: 'The text took longer than 85 s to process; send a shorter text. Not charged.' } } } },
  { name: 'HTML error page', skill: 'detect', want: /p3n answered 502/, next: { status: 502, html: '<!doctype html><title>502</title>Bad gateway' } },
  { name: 'failed run: its error', skill: 'humanize', want: /provider failed/,
    next: { status: 200, body: { ...FIXTURES.humanize, status: 'failed', output: null, error: 'The model provider failed. You were not charged.' } } },
  { name: 'detect without a score', skill: 'detect', want: /without a result/, next: { status: 200, body: { ...FIXTURES.detect, output: { version: 'detect-v9' } } } },
  { name: 'humanize without a rewrite', skill: 'humanize', want: /without a result/, next: { status: 200, body: { ...FIXTURES.humanize, output: { version: 'humanize-v9', ai_after: 0.1 } } } },
];

// The rewrite headline says "No longer" or "Still" only when the detector model put the text sent in the AI
// class (ai_before >= 0.5). It can score text at 0% that Check called likely AI.
export const HEADLINES = [
  [{ ai_before: 0.95, ai_after: 0.01, passes: true }, 'No longer reads as AI'],
  [{ ai_before: 0.08, ai_after: 0.02, passes: true }, "Doesn't read as AI"],
  [{ ai_before: 0.88, ai_after: 0.71, passes: false, label_after: 'ai' }, 'Still reads as AI'],
  [{ ai_before: 0.3, ai_after: 0.62, passes: false, label_after: 'ai' }, 'Reads as AI'],
  [{ ai_before: null, ai_after: 0.04, passes: true }, "Doesn't read as AI"],
];

const page = (body) => `<!doctype html><meta charset="utf-8"><title>p3n test</title>
<style>body{font:16px/1.6 system-ui;max-width:640px;margin:40px auto;padding:0 20px;color:#222}textarea,[contenteditable]{width:100%;min-height:140px;font:inherit;padding:10px;border:1px solid #bbb;border-radius:6px}</style>${body}`;
export const PAGES = {
  '/textarea': page(`<h1>Compose</h1><textarea id="box">${SHORT}</textarea>`),
  '/rich': page(`<h1>Email</h1><div id="box" contenteditable="true"><div>Hi team,</div><div>${SHORT}</div><div>Thanks</div></div>`),
  '/static': page(`<h1>Blog post</h1><article><p id="box">${AI_TEXT}</p></article>`),
  '/lines': page(`<h1>Notes</h1><textarea id="box">Intro line.\n${SHORT}</textarea>`),
};

// Serves the test pages, and with `api: true` also a stand-in for api.p3n.si: the canned runs, and a 401
// for any key on /v1/me (the options page's wrong-key check).
export async function startServer({ api = false } = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Expose-Headers': 'X-Free-Remaining' };
  const server = http.createServer((req, res) => {
    const skill = api && req.url.match(/^\/v1\/(?:runs\/mock-)?(detect|humanize)$/)?.[1];
    if (api && req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (skill) {
      const a = reply(skill);
      if (a.drop) return res.socket.destroy();
      return res.writeHead(a.status, { ...cors, 'Content-Type': a.type, 'X-Free-Remaining': '9' }).end(a.body);
    }
    if (api && req.url === '/v1/me') return res.writeHead(401, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(FIXTURES.me));
    res.writeHead(PAGES[req.url] ? 200 : 404, { 'Content-Type': 'text/html' }).end(PAGES[req.url] ?? 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export const selectField = () => { const b = document.querySelector('#box'); b.focus(); b.setSelectionRange(0, b.value.length); return b.value; };
// From the end of the first line, the way a drag from there selects: the selection starts with the line break.
export const selectFromLineBreak = () => { const b = document.querySelector('#box'); b.focus(); const i = b.value.indexOf('\n'); b.setSelectionRange(i, b.value.length); return b.value.slice(i); };
export const selectNode = (sel) => new Function(`const n = document.querySelector(${JSON.stringify(sel)}); const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.closest('[contenteditable]')?.focus(); return s.toString();`);

// The score counts to its value: true once the number on screen is the stated one and the bar is at rest.
export const scoreSettled = () => {
  const n = document.querySelector('.score .num');
  const sr = document.querySelector('.score .sr');
  return !!n && n.textContent === sr.textContent && !document.querySelector('.meter i')?.style.transform;
};

// Page edits made after the selection was taken: Replace must refuse and leave the page as it is.
// [page, select, edit (returns the page's text after the edit)]
// The dark palette is on (ui/base.css, prefers-color-scheme): the page's ground and the header logo.
export const darkApplied = () => getComputedStyle(document.body).backgroundColor === 'rgb(22, 19, 15)'
  && document.querySelector('.brand img').currentSrc.endsWith('/icons/logo-dark.png');

export const GUARDS = [
  ['/textarea', selectField, () => { const b = document.querySelector('#box'); b.value = `Edited. ${b.value}`; return b.value; }],
  ['/rich', selectNode('#box div:nth-child(2)'), () => { document.querySelector('#box div:nth-child(2)').firstChild.insertData(0, 'Edited. '); return document.querySelector('#box').innerText; }],
];

// Runs the ODD cases and a too-short Check in an open panel page.
export async function oddAnswers(panel, ok) {
  for (const c of ODD) {
    mock.queue = [c.next];
    await panel.evaluate((t, btn) => {
      document.querySelector('#result').replaceChildren();
      const el = document.querySelector('#text'); el.value = t; el.dispatchEvent(new Event('input')); document.querySelector(btn).click();
    }, AI_TEXT, c.skill === 'detect' ? '#check' : '#rewrite');
    await panel.waitForFunction(() => document.querySelector('#result')?.textContent.trim() && document.querySelector('#busy').hidden, { timeout: 15000, polling: 100 });
    const got = await panel.evaluate(() => ({ text: document.querySelector('#result').innerText, error: !!document.querySelector('#result .note.error'), href: document.querySelector('#result a.btn')?.href ?? null }));
    ok(`odd answer, ${c.name}`, got.error && c.want.test(got.text) && (!c.href || got.href === c.href), got.text.replace(/\s+/g, ' ').slice(0, 100));
  }
  mock.queue = [];
  const calls = mock.calls;
  await panel.evaluate(() => {
    document.querySelector('#result').replaceChildren();
    const el = document.querySelector('#text'); el.value = 'Too short to check.'; el.dispatchEvent(new Event('input')); document.querySelector('#check').click();
  });
  const msg = await panel.$eval('#result', (r) => r.innerText);
  ok('Check under 40 characters: explained, no call', /at least 40/.test(msg) && mock.calls === calls, msg.slice(0, 100));

  // A long text answers 202 and the panel polls the run; a dropped connection on the way doesn't end it.
  mock.queue = [{ status: 202, body: { ...FIXTURES.detect, status: 'queued', output: null } }, { drop: true }];
  const before = mock.calls;
  await panel.evaluate((t) => {
    document.querySelector('#result').replaceChildren();
    const el = document.querySelector('#text'); el.value = t; el.dispatchEvent(new Event('input')); document.querySelector('#check').click();
  }, AI_TEXT);
  await panel.waitForFunction(() => document.querySelector('#result')?.textContent.trim() && document.querySelector('#busy').hidden, { timeout: 20000, polling: 100 });
  const polled = await panel.evaluate(() => ({ score: !!document.querySelector('#result .score'), text: document.querySelector('#result').innerText }));
  ok('202 answer: polled through a dropped connection to the result', polled.score && mock.calls - before === 3, `${mock.calls - before} calls; ${polled.text.replace(/\s+/g, ' ').slice(0, 60)}`);
  mock.queue = [];
}
