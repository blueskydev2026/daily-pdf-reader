# Chrome/Edge extension packaging

This folder prepares the existing PDF reader to run as a Manifest V3 extension.

## Current safe scope

- The extension action opens `index.html` inside the extension package.
- The reader still keeps the existing file-open flow: file picker, drag and drop, saved state, annotations, signatures, export and print tools.
- External runtime JavaScript was moved into `vendor/` so the extension does not depend on CDN code at runtime.

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
5. Click the extension icon and open a PDF with the existing open/drop control.

The upload ZIP is created at `dist/daily-pdf-reader-extension.zip`.

## Default PDF app

The extension cannot make itself the Windows default app for `.pdf` files. Keep using the PWA `manifest.webmanifest` and its `file_handlers` entry for installed-app file handling. Users may still need to approve or select the installed app through Windows/Chrome/Edge.
