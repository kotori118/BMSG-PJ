# BE:FIRST LIVE ARCHIVE

Independent React + TypeScript + Vite application, Firebase Auth (Google), Firestore and authenticated callable Functions. The canonical product specification is Google Drive **BE:FIRST LIVE ARCHIVE｜アプリ設計書 v0.24（2026-11-11）**. This folder is an implementation checkpoint, not a declaration that Phase 1 acceptance is complete.

## Run

Node 22 (Functions runtime), Java 21 (Firestore emulator).

```sh
npm ci
npm --prefix functions ci
cp .env.example .env.local
npm run dev
```

For an explicitly isolated in-memory trial UI, set `VITE_PREVIEW=true` in `.env.local`. Real mode defaults to false and requires Firebase configuration. Fixture attendance begins empty. Preview actions do not write Firebase or Sheets. No offline cache or service worker is installed.

```sh
npm test
npm run test:rules
npm run build
npm run build:functions
```

## Boundaries

- Universe GAS, BMSG-DB and spreadsheet data are not modified. Root `.claspignore` excludes this entire folder from GAS upload.
- The backend reads only the configured `06_Songs` A:G range with `spreadsheets.readonly`. Use a dedicated runtime service account shared as **Viewer**. No access token, private key or full private spreadsheet export is committed.
- Every callable verifies the configured owner UID and Google provider. Firestore rules allow owner reads only; validated server functions own all writes.
- A trial fixture is never automatically imported. Historical bulk registration requires a separate preview and the owner's explicit confirmation. Personal attendance and seats are not committed.
- PREDICT and backtesting are intentionally not implemented in this phase.

See [implementation plan and schema](docs/IMPLEMENTATION.md), [Firebase setup](docs/FIREBASE_SETUP.md), [trial data](docs/TRIAL_DATA.md) and [audit and remaining gates](docs/AUDIT.md).
