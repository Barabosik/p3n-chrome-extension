# Store listings

What goes into the Chrome Web Store and addons.mozilla.org forms. The zips come from `node dev/build.mjs`, and the images are in this folder.

Listings: Chrome Web Store item `bingopgkcgafmnpkoeckijkcbnfmchnh` (chromewebstore.google.com/detail/bingopgkcgafmnpkoeckijkcbnfmchnh), Firefox slug `p3n` (addons.mozilla.org/firefox/addon/p3n). Both submitted for review on 2026-10-20 as 0.1.0; Chrome approved it on 2026-10-21. Chrome 0.1.1 submitted on 2026-10-22 with the Chrome listing changes below; Firefox 0.1.1 waits for 0.1.0's approval. 0.1.2 is next: see [0.1.2](#012) at the end.

## Description (both stores)

```
Select text on any page, right-click, and pick p3n. It tells you whether the text reads as AI-written and which sentences give it away. Or it rewrites the text so it reads as human, and puts the new version back in the page.

Check for AI: a score, a short reason, and the sentences that read as AI.

Rewrite: a new version that keeps your facts and drops the filler. Replace puts it where your selection was, in text boxes and in editors like webmail, and Ctrl+Z undoes it.

Results open in the side panel, next to the page.

Free to try: without an account you get 10 checks or rewrites an hour, up to 5,000 characters each. For more, sign up at p3n.si (you get free credit), then create an API key.

Privacy: the extension sends only the text you selected, only when you click, and only to api.p3n.si. The extension keeps no history and has no analytics. p3n.si keeps the text for up to 7 days.

Google Docs replaces the browser's right-click menu, so p3n doesn't show up there. Paste the text into the panel instead.

Open source: https://github.com/Barabosik/p3n-chrome-extension

Other p3n apps: https://nikita-andreiev.com/p3n/
```

## Chrome Web Store

| Field | Value |
| --- | --- |
| Summary | From the manifest's `description`. |
| Category | Productivity › Tools |
| Language | English |
| Store icon | `icons/128.png` |
| Screenshots | `screenshot-check.png`, `screenshot-rewrite.png` (1280×800) |
| Small promo tile | `promo-440x280.png` |
| Official URL | nikita-andreiev.com (verified in Search Console) |
| Homepage | https://nikita-andreiev.com/p3n/ |
| Support | https://github.com/Barabosik/p3n-chrome-extension/issues |
| Privacy policy | https://github.com/Barabosik/p3n-chrome-extension/blob/main/PRIVACY.md |
| Visibility | Public, all regions |

Privacy practices tab:
- **Single purpose:** Check selected text for signs of AI writing, and rewrite it so it reads as human-written.
- **contextMenus:** Adds the p3n item to the right-click menu when text is selected.
- **activeTab:** Lets the extension read the selected text in the tab where the user picked a p3n menu item, only after that click.
- **scripting:** Runs one small function in that tab to read the selection, and another to put the rewrite in its place when the user clicks Replace.
- **sidePanel:** Shows the result in the side panel next to the page.
- **storage:** Keeps the user's optional API key and light/dark choice (local storage) and passes the selected text from the menu to the side panel (session storage).
- **Host permission `https://api.p3n.si/*`:** The p3n API that checks and rewrites the text. It is the only host the extension contacts.
- **Remote code:** No. All code ships in the package.
- **Data collected:** Website content (the selected text, sent when the user clicks) and Authentication information (the optional API key). Not sold or transferred to third parties outside the approved use, not used for anything unrelated to the single purpose, not used for credit decisions.

## addons.mozilla.org

| Field | Value |
| --- | --- |
| Name | From the manifest. |
| URL slug | `p3n` |
| Summary | From the manifest's `description`. |
| Categories | Language Support |
| Licence | MIT |
| Homepage | https://p3n.si |
| Support site | https://github.com/Barabosik/p3n-chrome-extension/issues |
| Privacy policy | The text of `PRIVACY.md` |
| Source code | Not needed: no build step, minifier or bundler. The zip is the repo's files as they are. |

Notes for the reviewer:

```
No build step: the package is the source at https://github.com/Barabosik/p3n-chrome-extension, copied as is by dev/build.mjs, which only rewrites the manifest for Firefox (background scripts, sidebar_action, gecko ID, data collection).

To test without an account: select text on any page, right-click, p3n > Check for AI. The sidebar opens with the result. Calls without an API key are free, 10 an hour per IP, up to 5,000 characters.

The add-on contacts only https://api.p3n.si, and only when the user clicks. Data collection: websiteContent (the selected text) and authenticationInfo (the optional API key).
```

## 0.1.2

Ready, not submitted. Chrome: after it approves 0.1.1. Firefox: after AMO approves 0.1.0.

What's new (AMO's version notes; the Chrome Web Store has no such field):

```
- Clearer messages: the free limit counts free calls and says to sign up at p3n.si, then create an API key; a refused key points to the API key button.
- Rewrite says when a selection is under eight words, before it uses a call.
- Replace mentions Ctrl+Z only where the page can undo it, and Use selected text in Google Docs says to paste instead.
- A p3n.si link at the foot of the panel, and the theme button that follows your system is labelled "Match system theme".
- After a Check, the sentences it lists are highlighted in the text on the page, or in the panel under "In your text" for pasted text and text boxes. Clear highlights takes them away.
```

Listing changes that go with it, in both stores:
- **Description:** the free line (sign up, then create a key), the privacy line (the extension keeps no history; p3n.si keeps the text for up to 7 days), and a last line, "Other p3n apps: https://nikita-andreiev.com/p3n/".
- **Screenshot:** `screenshot-rewrite.png`, rebuilt from the mocked run. Only its footnote changed ("The rewrite drops filler…", was "Humanize drops filler…"). `screenshot-check.png` and the promo tile stay.
- **Unchanged:** the summary (the manifest's `description`), permissions, host permissions, data collection and the privacy practices answers.
