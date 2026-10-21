# Contributing

Plain JavaScript with no bundler. Chrome loads the repo folder as it is. `dev/` holds the tests and tools, and isn't shipped.

## Layout

- `background.js`: the right-click menu. On a click it opens the panel, reads the selection and hands it over.
- `lib/page.js`: the two functions injected into the page. One reads the selection, the other replaces it with `execCommand('insertText')` so undo works.
- `lib/api.js`: the API client.
- `lib/ext.js`: what differs between Chrome and Firefox.
- `ui/panel.*`: the side panel. It calls the API itself, because the browser can stop the background script during a long rewrite.
- `ui/options.*`: the API key page.

## Test

```bash
cd dev
npm install
MOCK=1 npm run e2e
MOCK=1 npm run e2e:firefox
npm run lint:firefox
```

The tests load the extension into a headless Chrome or Firefox, open local test pages (an article, a textarea, a webmail-style editor) and run Check and Rewrite, including Replace and undo. `MOCK=1` answers with canned API results. Without it the tests call the live API and use 3 or 4 of the free hourly calls.

- `ONLY=article,textarea,email,headline,guard,odd` runs some of the scenarios. These run only with `MOCK=1`: `headline` checks the rewrite's headline for each kind of score, `guard` that Replace refuses once the page text has changed, and `odd` the error answers (free limit, too long, an HTML error page, a failed run, an answer without its result) and a Check under 40 characters.
- Light and dark: the pages follow the browser's setting, and the tests set it either way. In Chrome the mocked `lines` and `article-dark` run in dark, and the options page is checked in both; Firefox checks dark in a second browser (`dark`).
- `CHROME=` and `FIREFOX=` point at another browser binary. Edge and Brave work as `CHROME=`.
- `FRAMES=1` saves frames of each result as it animates in.

A script can't click the browser's right-click menu or open the side panel. So the tests start jobs by message and show the panel in a tab. Try the real menu by hand before a release.

## Build

`node dev/build.mjs` writes `dist/chrome`, `dist/firefox` and a store zip of each. The Firefox build only rewrites the manifest. The zips are made with bsdtar or `zip`, because the stores want forward slashes in paths.

Images: `python dev/store-shots.py` builds the store screenshots from a test run (`check` or `rewrite` builds just one), `python dev/icons.py` the icons, `python dev/promo-tile.py` the promo tile. The store copy is in `store/listing.md`.

CI runs the mocked tests and the Firefox lint on every push. A `v*` tag builds a release and can upload to both stores; see [docs/CI.md](docs/CI.md).

The Firefox add-on ID, `p3n@p3n.si`, can't change once it's on addons.mozilla.org.
