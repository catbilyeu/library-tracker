# Library Tracker

A browser-first app to track your personal library. By default, data is stored locally (IndexedDB). Optionally, sign in with Firebase to sync to the cloud.

## Quick Start (local)

1) Serve the folder with a local web server
   - Python
     ```bash
     python3 -m http.server 8080
     # open http://localhost:8080
     ```
   - Node http-server
     ```bash
     npx http-server -p 8080
     # or HTTPS (required if not using localhost)
     npx http-server -S -C cert.pem -K key.pem -p 8443
     # open https://localhost:8443
     ```

2) Optional: Enable Firebase (cloud sync)
   - Create a Firebase project (https://console.firebase.google.com)
   - In Project Settings → General → Your apps, add a Web App and copy the config object
   - Copy `js/firebase-config.sample.js` to `js/firebase-config.js`
   - Paste your config into `window.firebaseConfig = { ... }`
   - Ensure Authentication → Sign-in method has Google enabled
   - Under Authentication → Settings, add the authorized domain(s) (e.g., localhost, yoursite.com)
   - For Google OAuth, ensure your OAuth consent screen is set up and authorized redirect URIs include:
     - https://<yourapp>.firebaseapp.com/__/auth/handler
     - https://<yourapp>.web.app/__/auth/handler

3) Open the app and (optionally) sign in
   - Without firebase-config.js: app runs in offline/local mode
   - With firebase-config.js: click “Sign in” to sync your books/settings to Firestore

## Production deployment

Set a CSP response header (not a meta tag) that allows MediaPipe Hands and Firebase:

Example (tune to your needs):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://*.google.com https://*.gstatic.com https://apis.google.com https://cdn.jsdelivr.net;
  connect-src 'self' https://openlibrary.org https://*.googleapis.com https://*.google.com https://*.gstatic.com https://firestore.googleapis.com https://cdn.jsdelivr.net https://securetoken.google.com https://identitytoolkit.googleapis.com https://apis.google.com https://firebaseinstallations.googleapis.com https://oauth2.googleapis.com;
  img-src 'self' https: data:;
  style-src 'self' 'unsafe-inline';
  font-src 'self' data:;
  media-src 'self' blob: data:;
  worker-src 'self' blob:;
  frame-src https://*.google.com https://*.firebaseapp.com https://*.web.app;
  base-uri 'self';
```

Notes:
- Use headers for `frame-ancestors` (meta is ignored for that directive)
- If you see WASM compile errors for MediaPipe, ensure 'wasm-unsafe-eval' (and 'unsafe-eval' for emscripten) are present in `script-src`.

## Features

- Add books by typing an ISBN-13/ISBN-10 or scanning barcodes (EAN-13)
- Automatic metadata from Open Library (title, authors, cover)
- Shelves view with fast search (Fuse.js)
- Book modal with lend/return history and remove
- Import/Export your whole library as JSON
- Optional hands-free cursor (MediaPipe Hands)
- Optional voice commands (Web Speech API)
- Optional cloud sync with Firebase (Auth + Firestore)

## Hands‑Free & Voice tips
- Hands‑Free and Voice auto‑enable on load if you previously toggled them on in Settings
- For camera/mic, use HTTPS or http://localhost and grant permissions

## Troubleshooting
- If Voice fails in your browser: not all browsers ship SpeechRecognition; Chrome desktop supports `webkitSpeechRecognition`
- If Motion cursor restarts: check CSP header and camera permissions; verify page served over HTTPS/localhost
- If lending doesn’t appear: open a book modal and check Borrow history (persisted in IndexedDB or Firestore when signed in)

## Development Notes
- Static, single‑page app — serve with a local web server
- No build step; contributions welcome!
