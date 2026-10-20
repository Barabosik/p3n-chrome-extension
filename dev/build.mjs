// Builds the store packages from the source in the repo root:
//   dist/chrome/   as is (Chrome, Edge, Brave and other Chromium browsers)
//   dist/firefox/  same code, manifest adapted: a sidebar instead of the side panel, background scripts
//                  instead of a service worker, and the Firefox ID and data-collection declaration
// and a zip of each (dist/p3n-<browser>-<version>.zip).   node dev/build.mjs
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FILES = ['manifest.json', 'background.js', 'lib', 'ui', 'icons'];

const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));

function firefox(m) {
  const f = structuredClone(m);
  delete f.minimum_chrome_version;
  delete f.side_panel;
  delete f.options_page;
  f.permissions = f.permissions.filter((p) => p !== 'sidePanel');
  // Firefox has no background service workers; it runs the same module as an event page.
  f.background = { scripts: ['background.js'], type: 'module' };
  f.sidebar_action = { default_panel: 'ui/panel.html', default_title: 'p3n', default_icon: m.action.default_icon, open_at_install: false };
  f.options_ui = { page: 'ui/options.html', open_in_tab: true };
  f.browser_specific_settings = {
    gecko: {
      // Permanent once listed on addons.mozilla.org.
      id: 'p3n@p3n.si',
      // 140: the built-in data-collection consent below (also covers module background scripts, storage.session, scripting).
      strict_min_version: '140.0',
      // The selected text is website content; an API key, if the user adds one, is authentication info.
      data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] },
    },
  };
  return f;
}

await rm(DIST, { recursive: true, force: true });
for (const [name, m] of [['chrome', manifest], ['firefox', firefox(manifest)]]) {
  const dir = path.join(DIST, name);
  await mkdir(dir, { recursive: true });
  for (const f of FILES) await cp(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  // The stores need forward-slash paths in the zip. bsdtar writes them (Windows' own tar.exe, not Git Bash's
  // GNU tar, which can't write zips; macOS's tar); on Linux, zip.
  const zip = path.join(DIST, `p3n-${name}-${m.version}.zip`);
  if (process.platform === 'linux') execFileSync('zip', ['-qr', zip, ...FILES], { cwd: dir });
  else execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-a', '-cf', zip, ...FILES], { cwd: dir });
  console.log(path.relative(ROOT, zip));
}
