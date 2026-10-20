import { me } from '../lib/api.js';

const key = document.querySelector('#key');
const status = document.querySelector('#status');
let saved = '';
let pending = 0;

function say(msg, kind = '') {
  status.textContent = msg;
  status.className = `note small ${kind}`;
  status.hidden = !msg;
  if (msg && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    status.animate([{ opacity: 0, transform: 'translateY(4px)' }, {}], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }
}

// Checks the key with p3n and saves it only if it works, so a typo never replaces a good key.
async function checkAndSave(k) {
  const mine = ++pending;
  say('Checking the key…');
  try {
    const m = await me(k);
    if (mine !== pending) return;
    if (k !== saved) await chrome.storage.local.set({ apiKey: k });
    saved = k;
    say(`Saved. Signed in as ${m.email}, balance $${Number(m.balance_usd).toFixed(2)}.`, 'ok');
  } catch (e) {
    if (mine !== pending) return;
    say(e.type === 'unauthorized' ? 'p3n doesn\'t accept this key, so it wasn\'t saved. Copy it again from the API keys page.' : e.message, 'error');
  }
}

let debounce;
key.addEventListener('input', () => {
  clearTimeout(debounce);
  const k = key.value.trim();
  if (!k) return say('');
  if (!/^p3n_\S+$/.test(k)) return say('Keys start with p3n_. Copy the whole key from the API keys page.', 'warn');
  debounce = setTimeout(() => checkAndSave(k), 400);
});

document.querySelector('#remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('apiKey');
  saved = '';
  key.value = '';
  say('Key removed. p3n still works without one, with the free hourly limit.');
});

(async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  saved = apiKey || '';
  key.value = saved;
  if (saved) checkAndSave(saved);
})();
