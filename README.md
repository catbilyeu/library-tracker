# Library Tracker

A browser-only app to track your personal library. No backend — everything is stored locally in your browser (IndexedDB). Works offline after first load.

## Features

- Add books by typing an ISBN-13/ISBN-10 or scanning barcodes (EAN-13) with your camera
- Automatic metadata from Open Library (title, authors, cover)
- Shelves view with fast search (Fuse.js)
- Book modal with lend/return history and remove
- Import/Export your whole library as JSON
- Optional hands-free cursor (MediaPipe Hands)
- Optional voice commands (Web Speech API)

## Requirements

- A modern Chromium-based browser (Chrome, Edge) or Safari (features vary)
- For camera/microphone features (scanner, hands-free, voice):
  - Use HTTPS or http://localhost (secure context) — browsers block camera/mic on plain HTTP
  - Allow camera/microphone permissions when prompted

## Quick Start (local)

1) Clone and open the project directory

2) Serve the folder with a local web server (recommended options):

- Python
  ```bash
  # HTTP (OK for localhost)
  python3 -m http.server 8080
  # then open http://localhost:8080
  ```
- Node http-server
  ```bash
  npx http-server -p 8080
  # HTTPS (required if not using localhost)
  npx http-server -S -C cert.pem -K key.pem -p 8443
  # then open https://localhost:8443
  ```

3) Open the app in your browser and grant permissions when prompted for camera/mic (only if using Scan, Hands‑Free, or Voice).

Note: On first run with an empty library, the app may auto-import a small sample from `real-books-50.json` so you can explore the UI. You can remove those books or import your own.

## How to Use

- Search
  - Use the search box in the header to filter your shelves by title, author, or ISBN.

- Add a book
  - Type an ISBN and click “Add”, or press Enter
  - Or click “Scan” to open the barcode scanner and point your camera at an EAN‑13 barcode (most modern book barcodes)

- View details / Lend / Return / Remove
  - Click a book cover to open its details modal
  - Lend: enter borrower name; the app records the date
  - Return: marks the most recent borrow record as returned
  - Remove: permanently deletes the book from your local library

- Import / Export
  - Export: downloads a JSON backup of all books and settings
  - Import: choose a JSON file exported from this app (basic validation, new ISBNs are added; existing ISBNs are skipped)

- Settings
  - Click “Settings” to choose:
    - Camera for hands‑free cursor
    - Microphone for voice
    - Hands‑free sensitivity
  - You can also toggle Hands‑Free and Voice from the header

## Hands‑Free Cursor (optional)

- Toggle via the “Hands‑Free” button or in Settings
- A small cursor appears; move your index fingertip to move the cursor
- Make a closed hand gesture to click (debounced so it won’t spam clicks)
- Click the “Stop” button on the overlay or toggle Hands‑Free off to exit

Tips
- Ensure good lighting and keep your hand within the camera view
- If camera fails, check site permissions and try switching camera in Settings

## Voice Commands (optional)

- Toggle via the “Voice” button or in Settings
- Press and hold Space to talk in Push‑to‑Talk mode; in continuous mode it will listen automatically

Examples
- “search dune”
- “open scanner”
- “add isbn 9780143127741”
- “lend dune to Alex”
- “return dune”
- “remove dune”
- “hands free on” / “hands free off”
- “voice off”

If you hear speech repeated twice, make sure only one TTS source is active (don’t use a system screen reader’s speak selection at the same time as the app’s voice confirmations).

## Data and Privacy

- All data is stored locally in your browser using IndexedDB
- No account or server — your library stays on your device
- Use Export to back up, and Import to restore on another device/browser profile

## PWA

- A basic service worker (`sw.js`) caches static assets for faster loads
- Covers and live metadata are fetched from Open Library and not permanently cached

## Keyboard and Accessibility

- In the header:
  - Enter adds the typed ISBN
- In dialogs:
  - Tab cycles focus, Esc closes overlays
- Scanner: Esc or “Exit” closes
- Settings and modal dialogs have focus traps and cancellable actions

## Troubleshooting

- Camera/mic not working
  - Use HTTPS or http://localhost
  - Check browser site permissions (camera and microphone)
  - Close other apps using the device

- Barcode won’t scan
  - Ensure EAN‑13 barcode is visible, well lit, and fills a good portion of the view
  - Try switching cameras in Settings

- Voice recognition is unreliable
  - Try another microphone in Settings
  - Background noise and accents can affect recognition; speak clearly

- Voice feedback speaks twice
  - Turn off overlapping features (e.g., browser “Read Aloud” or a screen reader) or disable the app’s Voice toggle

## Tech Stack

- HTML/CSS/JavaScript (no build step)
- IndexedDB via idb (loaded by `db.js`)
- Open Library API for metadata; covers via covers.openlibrary.org
- Quagga2 for barcode scanning
- MediaPipe Hands for hands‑free cursor
- Web Speech API for voice recognition and speech synthesis

## Project Structure

- `index.html` — app shell and script/style includes
- `js/` — modules: storage, api, shelves, modal, barcode, search, importExport, handsfree, voice, settings, utils, main
- `styles/` — base UI, shelves grid, modal, hands‑free overlay
- `assets/` — favicon and static assets
- `sw.js` — service worker
- `manifest.json` — PWA manifest

## Development Notes

- Static, single‑page app — open via a local server to avoid CORS and enable camera/mic
- Chrome allows camera/mic on http://localhost; other hosts typically require HTTPS
- No backend required; contributions welcome!
