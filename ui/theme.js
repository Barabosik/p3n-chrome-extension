// Light or dark, like p3n.si. Until the user clicks the panel's sun/moon button ([data-theme-toggle]) the pages
// follow the browser; a click picks the other theme and keeps it in storage.local as `theme`. A plain script in
// <head>, so it runs before the page paints: a copy in localStorage (read at once, where storage.local answers later)
// means a kept theme never flashes the other. It sets data-theme on <html> to what shows, light or dark (base.css),
// and labels the button. Open pages follow a change made in another one.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const root = document.documentElement;
  const os = matchMedia('(prefers-color-scheme: dark)');
  const valid = (t) => (t === 'light' || t === 'dark' ? t : null);
  let kept = null;
  try { kept = valid(localStorage.getItem('theme')); } catch {}

  const apply = () => {
    const dark = kept ? kept === 'dark' : os.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    const flip = dark ? 'Switch to light theme' : 'Switch to dark theme';
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.setAttribute('aria-label', flip); b.title = flip; });
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
  const take = (t) => {
    kept = valid(t);
    try { kept ? localStorage.setItem('theme', kept) : localStorage.removeItem('theme'); } catch {}
    switchTo();
  };

  apply();
  ext.storage.local.get('theme').then(({ theme }) => take(theme));
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'theme' in changes) take(changes.theme.newValue); });
  os.addEventListener('change', switchTo);
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    take(root.dataset.theme === 'dark' ? 'light' : 'dark');
    ext.storage.local.set({ theme: kept });
  });
})();
