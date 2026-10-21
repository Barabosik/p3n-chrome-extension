# CI and releases

Two GitHub Actions workflows, in `.github/workflows/`. Both run on Ubuntu with Node 24, and install the dev tools from `dev/package-lock.json`. Neither keeps the job's GitHub token in the checkout (`persist-credentials: false`), so the tools' install scripts can't read it.

## ci.yml: every push and pull request to `main`

1. Builds `dist/` (`node dev/build.mjs`).
2. Lints the Firefox build with `web-ext lint`. Errors fail the run. The one warning, about Firefox for Android, is expected.
3. Runs the end-to-end checks with the mocked API (`MOCK=1`) in the runner's Chrome and Firefox. It never calls api.p3n.si. `CI` is set on the runner, so Chrome runs without its sandbox.
4. Keeps the store zips (`store-zips`) and the screenshots from `dev/out/` (`screenshots`) as artifacts of the run.

## release.yml: a tag `v*`

1. Fails unless the tag is `v` plus the `version` in `manifest.json`.
2. Builds both zips, lints the Firefox build, runs the same mocked end-to-end checks as CI, and attaches the zips to a GitHub Release for the tag. A failed check stops the release before any store upload.
3. Chrome Web Store, if its five secrets are set: uploads `p3n-chrome-<version>.zip` and submits it for review.
4. addons.mozilla.org, if its two secrets are set: submits `dist/firefox` as a listed version for review (`web-ext sign --channel listed`). It doesn't wait for the review.

Without a store's secrets, its step is skipped with a notice and the run still passes. Re-running the workflow is safe for the release (the zips are replaced), but the stores refuse a version they already have.

To release, raise `version` in `manifest.json`, commit and push, then tag that commit:

```bash
git tag v0.1.1
```

```bash
git push origin v0.1.1
```

The first version goes to each store by hand: the Chrome Web Store API can't create a new item, and AMO wants the listing details (summary, categories) with the first listed version. The workflow handles the versions after that.

## Secrets

Add them in the repo's Settings → Secrets and variables → Actions. Never put the values in a file or a commit.

| Secret | What it is | Where to get it |
| --- | --- | --- |
| `CWS_EXTENSION_ID` | The item's 32-letter ID | Chrome Web Store Developer Dashboard, on the item's page |
| `CWS_PUBLISHER_ID` | The developer account's publisher ID | Developer Dashboard → Settings |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | OAuth client for the Chrome Web Store API | Google Cloud console, see below |
| `CWS_REFRESH_TOKEN` | Refresh token for that client | OAuth 2.0 Playground, see below |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO API key: "JWT issuer" and "JWT secret" | https://addons.mozilla.org/developers/addon/api/key/ |

Chrome Web Store, following Google's guide at https://developer.chrome.com/docs/webstore/using-api:

1. In the Google Cloud console, pick or create a project and enable the Chrome Web Store API.
2. Configure the OAuth consent screen (External).
3. Create an OAuth client ID of type Web application, with `https://developers.google.com/oauthplayground` as a redirect URI. That gives the client ID and secret.
4. In the OAuth 2.0 Playground, use your own credentials (settings), authorize the scope `https://www.googleapis.com/auth/chromewebstore` while signed in as the Google account that owns the item, and exchange the code for tokens. Keep the refresh token.

While the consent screen is in Testing, Google expires its refresh tokens after 7 days. Set it to In production so the token keeps working. Publishing through the API also needs 2-step verification on that Google account.

The upload uses the Chrome Web Store API v2 (chrome-webstore-upload-cli 4), which needs the publisher ID. Google's support for the old v1.1 API ended on 15 October 2026.
