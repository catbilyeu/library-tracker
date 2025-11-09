# Library Tracker (browser-only)

Static web app to track a personal library. No backend. Data stored in IndexedDB.

## Quick start

- Serve over HTTPS or http://localhost so camera/mic work.
- Open index.html in a local web server (e.g., `npx http-server -S -C cert.pem -K key.pem` or `python3 -m http.server`).
- Click Scan to add by barcode or Add ISBN to type it.

## Tech

- HTML/CSS/JavaScript only
- IndexedDB via idb
- Open Library API for metadata, covers.openlibrary.org for covers
- Quagga2 for EAN-13 scanning
- MediaPipe Hands (planned) for hands-free cursor
- Web Speech API (planned) for voice commands

## Structure

- js/: agents (main, db, api, shelves, modal, barcode, search, importExport, handsfree, voice, settings, utils)
- styles/: base UI, shelves grid, modal, hands-free cursor

## Events (pub/sub)

See main.js for publish/subscribe. Key events wired:
- shelves:render, modal:open/close, book:add/added/updated/removed, scanner:open/detected/close, search:query, import:done, handsfree:toggle, voice:toggle

## Roadmap

- Implement full hands-free with MediaPipe Hands
- Implement voice recognition intents with Web Speech API
- Settings panel with device selection
- Import schema validation and conflict handling
- PWA service worker caching
