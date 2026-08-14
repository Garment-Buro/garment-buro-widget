# GARMENT BURO / Project Control

Internal live dashboard and compact desktop widget. Google Sheets remain the source of truth. The widget sends explicit employee commands to GPT; the model prepares a constrained mutation plan and the Apps Script gateway applies and verifies it in the existing Sheets model.

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

Task-management commands use the following write path:

```text
widget action + employee comment
  -> Apps Script taskCommand gateway
  -> fresh MASTER / TASK / TASK_UPDATES context
  -> OpenAI structured mutation plan
  -> guarded TASKS / TASK_UPDATES / SESSION_HANDOFFS write
  -> verification read
  -> updated dashboard state
```

The UI receives normalized entities only and does not know Google column names. Polling runs every 60 seconds, manual refresh is available on the full dashboard, and refresh failures keep the currently rendered state.

## Google Sheets

Execution System reads `PEOPLE`, `GOALS`, `MILESTONES`, `TASKS`, `TASK_CONTEXT`, `PROGRESS_GATES`, and `CHANGE_EVENTS`. `NOW` is optional and treated as a derived view. Control System reads `ISSUES`.

Only active `VERIFIED_DONE` gates earn progress. A current task can show a dotted potential segment when it is listed in `CLOSED_BY_TASK`, but that segment does not become solid until the gate is verified.

For accounts where Google Cloud billing registration is unavailable, set `DASHBOARD_DATA_SOURCE=apps-script`. The complete Apps Script backend is in [`apps-script/Code.gs`](apps-script/Code.gs) and [`apps-script/task-commands.gs`](apps-script/task-commands.gs); deployment and sheet requirements are documented in [`apps-script/README.md`](apps-script/README.md). It reads the private dashboard tables, sends constrained task decisions to OpenAI, verifies writes, records session handoffs, and acknowledges delivered notifications.

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
OPENAI_MODEL=gpt-5.4-mini
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

For task commands, `OPENAI_API_KEY` belongs in Apps Script Properties and should be owned by the OpenAI project service account. Every installed desktop client then uses the same protected GPT/Sheets gateway. The key must not be bundled into React or a distributed installer. The older native read-only assistant command can still read `.env.local` during development, but the task-management UI no longer exposes that chat panel.

The widget sends only named intents (`accept`, `reject`, `stuck`, `waiting`, `fact`, `done`, `session_start`, `session_close`). GPT returns a strict structured plan; Apps Script applies only the coded fields and returns `SYNCED` after a verification read. The backend rejects unverified responses. See the Apps Script deployment guide for required columns and smoke tests.

The task-command gateway refreshes `00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ`, the task and recent task updates before every command and uses the desktop employee setting as `AUTHOR`. It does not use chat history as project state.

## Resilience

A successful Google response is normalized and atomically saved under `.data/`. If a later Google request fails, the app returns that last good normalized snapshot with `STALE_DATA`, the source error, and its age in minutes. Mock mode is never written into the Google snapshot.

## Checks

```bash
npm run test:acceptance
npm run lint
npx tsc --noEmit
npm run build
```

The acceptance suite covers current-task selection, gate-based progress, task potential, scope and forecast changes, waiting work, data gaps, snapshot fallback, factual graph construction, GPT context isolation, the no-local-mock command contract, and work-session/Pomodoro timing.

## Desktop App

The Tauri desktop app reuses the same React screens and progress engine as the browser dashboard. It stores the employee name and access code in the operating-system application-data folder; the code is not embedded in the installer.

On first launch the employee enters their name and shared access code. Name matching is case-insensitive and must resolve to a real row in `PEOPLE`; the app never falls back to another employee. The app then enables system startup, opens as a `520 x 260` widget inside a `540 x 280` frameless window, refreshes live data every minute, and remains available from the tray when closed. The expand button turns the same window into the `1440 x 900` full dashboard; `Свернуть виджет` returns it to widget mode. The pin button and the tray action toggle always-on-top on both macOS and Windows.

`Начать` sends an acceptance command to GPT and expects `IN_PROGRESS` after verified Sheets write. `Отклонить`, `Застрял`, `Жду`, and `Готово` require an employee comment. `Работаю` creates a persistent local work session; it can be paused, resumed, closed with a handoff comment, and can run a 25- or 50-minute Pomodoro visible in the compact widget.

The tray icon is static on macOS and Windows.

The real access code belongs only in `.env.local`, Google Apps Script properties, or the employee's local application settings. Never commit it to the repository.

Build the Windows installer with:

```bash
npm run desktop:bundle:windows
```

The installer is generated under `src-tauri/target/release/bundle/nsis/`. The workflow in `.github/workflows/desktop-build.yml` prepares both a Windows x64 installer and a universal macOS build for Intel and Apple Silicon Macs.

## Releases And Updates

Task data never requires an app update: Google Sheet and Apps Script changes appear on the next refresh. UI and native-app updates require a new signed release.

Tauri updater dependencies are present, but the updater is intentionally not initialized until a private release location and signing key are configured. Before distributing automatic updates, choose the release host, generate the Tauri updater key pair, keep the private key outside the repository, add the public key and endpoint to `tauri.conf.json`, and publish signed updater artifacts. macOS distribution without security warnings additionally requires Apple Developer ID signing and notarization; unsigned internal builds can still be tested manually on the employee's Mac.
