// Light or dark, like p3n.si. The choice (System, Light or Dark) lives in storage.local as `theme`, missing for
// System, which follows the browser. A plain script in <head>, so it runs before the page paints: a copy of the
// choice in localStorage (read at once, where storage.local answers later) means a chosen theme never flashes the
// other. It sets data-theme on <html> to what shows, light or dark (base.css), labels the panel's header button
// ([data-theme-toggle]) and marks the settings page's System, Light and Dark buttons ([data-theme-set]). Open
// pages follow a change made in another one.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const root = document.documentElement;
  const os = matchMedia('(prefers-color-scheme: dark)');
  const valid = (c) => (c === 'light' || c === 'dark' ? c : 'system');
  let choice = 'system';
  try { choice = valid(localStorage.getItem('theme')); } catch {}

  const apply = () => {
    const dark = choice === 'dark' || (choice === 'system' && os.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    const flip = dark ? 'Switch to light theme' : 'Switch to dark theme';
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.setAttribute('aria-label', flip); b.title = flip; });
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', b.dataset.themeSet === choice));
  };
  // A switch changes every colour at once, so no button fades on its own behind the rest.
  const switchTo = () => {
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(still);
    apply();
    getComputedStyle(root).color; // the new colours land before the transitions come back
    setTimeout(() => still.remove(), 1);
  };
  const take = (c) => {
    choice = valid(c);
    try { choice === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', choice); } catch {}
    switchTo();
  };
  const set = (c) => {
    take(c);
    choice === 'system' ? ext.storage.local.remove('theme') : ext.storage.local.set({ theme: choice });
  };

  apply();
  ext.storage.local.get('theme').then(({ theme }) => take(theme));
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'theme' in changes) take(changes.theme.newValue); });
  os.addEventListener('change', switchTo);
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', (e) => {
    // The header button: the other of light and dark, which is System again when it matches the browser.
    if (e.target.closest('[data-theme-toggle]')) {
      const want = root.dataset.theme === 'dark' ? 'light' : 'dark';
      return set(want === (os.matches ? 'dark' : 'light') ? 'system' : want);
    }
    const b = e.target.closest('[data-theme-set]');
    if (b) set(b.dataset.themeSet);
  });
})();
