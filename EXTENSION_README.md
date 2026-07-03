# Chrome/Edge extension packaging

This folder prepares the existing PDF reader to run as a Manifest V3 extension.

## Current safe scope

- The extension action opens the hosted PWA when `web-app-config.js` contains a `DAILY_PDF_READER_WEB_APP_URL`.
- If no hosted URL is configured yet, the extension action opens `index.html` inside the extension package.
- The reader still keeps the existing file-open flow: file picker, drag and drop, saved state, annotations, signatures, export and print tools.
- External runtime JavaScript was moved into `vendor/` so the extension does not depend on CDN code at runtime.

## Hosted PWA install flow

To make Chrome/Edge offer "Install app" like a regular web app, publish the reader as a PWA on `https://...` and update:

```js
// web-app-config.js
globalThis.DAILY_PDF_READER_WEB_APP_URL = "https://example.com/pdf-reader/";
```

After that, clicking the extension icon opens the hosted PWA instead of the packaged extension page. The hosted page can trigger `beforeinstallprompt`, show the browser install UI, and use `manifest.webmanifest` file handling after the user installs it.

For a release build, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -WebAppUrl "https://example.com/pdf-reader/"
```

Outputs:

- `dist/web-app` - upload this folder to the HTTPS host.
- `dist/daily-pdf-reader-extension.zip` - upload this ZIP to Chrome Web Store / Edge Add-ons.

If this repository is published to GitHub, `.github/workflows/deploy-pwa.yml` can deploy `dist/web-app` to GitHub Pages. After GitHub Pages gives you the final URL, run `tools\build-release.ps1` again with that URL so the extension points to the hosted PWA.

## Local test

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-extension.ps1
```

Then:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select `dist/chrome-edge-extension`.
5. Click the extension icon. If `web-app-config.js` has a hosted URL, the hosted PWA opens for install. Otherwise the packaged reader opens.

The upload ZIP is created at `dist/daily-pdf-reader-extension.zip`.

## Default PDF app

The extension cannot make itself the Windows default app for `.pdf` files. Keep using the PWA `manifest.webmanifest` and its `file_handlers` entry for installed-app file handling. Users may still need to approve or select the installed app through Windows/Chrome/Edge.
