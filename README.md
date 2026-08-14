# GARMENT BURO / Project Control

Internal live dashboard and compact desktop widget. Google Sheets remain the source of truth. The GPT navigator reads the current task context and live Drive instructions, but this release does not write tasks, gates, owners, deadlines, issues, or statuses back to Google.

## Local Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000/` for the full dashboard and `http://127.0.0.1:3000/widget` for the compact widget. Mock data is the default and requires no Google credentials.

## Data Flow

```text
GoogleSheetsDataSource / MockDataSource
  -> Normalizer
  -> ProgressEngine + DependencyEngine
  -> DashboardState
  -> /api/dashboard
  -> dashboard and widget UI
```

Significant GPT requests use a separate read-only context pass:

```text
00_MASTER PROMPT (fresh Drive export)
  + TASKS / TASK_CONTEXT (current dashboard read)
  + PLAYBOOKS / TASK_UPDATES / EVENTS / ROUTING_ACTIONS / SESSION_HANDOFFS
  -> server/native OpenAI Responses API call
  -> concise task guidance in the drawer or blocker action
```

The UI receives normalized entities only and does not know Google column names. Polling runs every 60 seconds, manual refresh is available on the full dashboard, and refresh failures keep the currently rendered state.

## Google Sheets

Execution System reads `PEOPLE`, `GOALS`, `MILESTONES`, `TASKS`, `TASK_CONTEXT`, `PROGRESS_GATES`, and `CHANGE_EVENTS`. `NOW` is optional and treated as a derived view. Control System reads `ISSUES`.

Only active `VERIFIED_DONE` gates earn progress. A current task can show a dotted potential segment when it is listed in `CLOSED_BY_TASK`, but that segment does not become solid until the gate is verified.

For accounts where Google Cloud billing registration is unavailable, set `DASHBOARD_DATA_SOURCE=apps-script`. The Apps Script web app reads the same private spreadsheets and returns the same normalized input contract without requiring a service-account key.

## Environment

Copy the relevant values from `.env.example` into `.env.local`:

```bash
DASHBOARD_DATA_SOURCE=google
DASHBOARD_PERSON_NAME=Вера
DASHBOARD_GOAL_ID=GOAL-002
DASHBOARD_REFRESH_MS=60000
DASHBOARD_SNAPSHOT_PATH=.data/dashboard-google-snapshot.json
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_ACCESS_TOKEN=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
GOOGLE_EXECUTION_SPREADSHEET_ID=...
GOOGLE_CONTROL_SPREADSHEET_ID=...
```

Choose one Google auth method:

```bash
GOOGLE_SHEETS_API_KEY=...
```

or:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

or:

```bash
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
```

The service account or Google API key must have read access to both spreadsheets. Credentials are imported only by server modules and must never use a `NEXT_PUBLIC_` prefix.

`OPENAI_API_KEY` is also server/native-only. Browser requests go through `/api/assistant`; the Tauri webview sends the task context to a native Rust command, so the key is never exposed to React. During `tauri dev`, the native process reads `.env.local` from the project root. A distributed installer does not bundle `.env.local` or the key; production distribution will need a protected remote backend or an operating-system secret setup.

The GPT navigator refreshes `00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ` before every request and uses `DASHBOARD_PERSON_NAME` (or the desktop employee setting) as `AUTHOR`. It does not use chat history as project state. The current direct Drive export works with the existing link access; if Drive sharing is restricted later, move these reads behind Apps Script or authenticated Google APIs.

## Resilience

A successful Google response is normalized and atomically saved under `.data/`. If a later Google request fails, the app returns that last good normalized snapshot with `STALE_DATA`, the source error, and its age in minutes. Mock mode is never written into the Google snapshot.

## Checks

```bash
npm run test:acceptance
npm run lint
npx tsc --noEmit
npm run build
```

The acceptance suite covers current-task selection, gate-based progress, task potential, scope and forecast changes, waiting work, data gaps, snapshot fallback, factual graph construction, the read-only Google contract, and GPT context isolation.

## Desktop App

The Tauri desktop app reuses the same React screens and progress engine as the browser dashboard. It stores the employee name and access code in the operating-system application-data folder; the code is not embedded in the installer.

On first launch the employee enters their name and shared access code. Name matching is case-insensitive and must resolve to a real row in `PEOPLE`; the app never falls back to another employee. The app then enables system startup, opens as a `520 x 260` widget inside a `540 x 280` frameless window, refreshes live data every minute, and remains available from the tray when closed. The expand button turns the same window into the `1440 x 900` full dashboard; `Свернуть виджет` returns it to widget mode. The pin button and the tray action toggle always-on-top on both macOS and Windows.

On macOS the menu-bar tray icon uses a lightweight transparent frame animation. The widget UI itself does not render that animation; Windows keeps the static tray icon.

The real access code belongs only in `.env.local`, Google Apps Script properties, or the employee's local application settings. Never commit it to the repository.

Build the Windows installer with:

```bash
npm run desktop:bundle:windows
```

The installer is generated under `src-tauri/target/release/bundle/nsis/`. The workflow in `.github/workflows/desktop-build.yml` prepares both a Windows x64 installer and a universal macOS build for Intel and Apple Silicon Macs.

## Releases And Updates

Task data never requires an app update: Google Sheet and Apps Script changes appear on the next refresh. UI and native-app updates require a new signed release.

Tauri updater dependencies are present, but the updater is intentionally not initialized until a private release location and signing key are configured. Before distributing automatic updates, choose the release host, generate the Tauri updater key pair, keep the private key outside the repository, add the public key and endpoint to `tauri.conf.json`, and publish signed updater artifacts. macOS distribution without security warnings additionally requires Apple Developer ID signing and notarization; unsigned internal builds can still be tested manually on the employee's Mac.
