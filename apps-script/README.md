# Apps Script backend

This folder is the complete Google Apps Script project for the widget:

- `Code.gs` — protected Web app entrypoint, dashboard reads, capabilities and notification ACK writes.
- `task-commands.gs` — GPT planning, constrained task mutations, sessions, idempotency and recovery.
- `drive-context.gs` — task-scoped Drive discovery and readable Docs/Sheets/Slides context via Drive export.
- `appsscript.json` — V8 runtime and the minimum Google scopes required by the code.

Do not keep the old read-only `doPost` beside `Code.gs`: Apps Script projects may only have one global `doPost` entrypoint.

## Test all-in-one file

For a temporary test deployment, generate one `Code.gs` containing the gateway,
GPT commands, Drive context and inline configuration:

```bash
npm run apps-script:bundle
```

The command reads secrets from `.env.local` and writes
`GB_WIDGET_ALL_IN_ONE.local.gs`. That generated file is ignored by Git. Copy it
entirely into the Apps Script project's single `Code.gs`, delete other `.gs`
files to avoid duplicate global declarations, save, and deploy a new Web app
version. The Google service-account JSON is intentionally not embedded: Apps
Script executes as the deployment owner and uses that owner's Drive/Sheets
permissions.

`appsscript.json` remains a separate Apps Script manifest and cannot be placed
inside `Code.gs`. Enable **Show appsscript.json manifest file in editor** in
Project Settings and paste the repository manifest before running
`authorizeGarmentWidget`.

## Script Properties

Open **Project Settings → Script Properties** and add:

| Property | Value |
| --- | --- |
| `ACCESS_TOKEN` | A newly generated random secret used by the widget |
| `EXECUTION_SPREADSHEET_ID` | Spreadsheet containing tasks and execution state |
| `CONTROL_SPREADSHEET_ID` | Spreadsheet containing `ISSUES` |
| `MASTER_PROMPT_DOCUMENT_ID` | Google Doc `00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ` |
| `DRIVE_ROOT_FOLDER_ID` | Canonical project folder; currently `1X4Qe4giI3mEnPUZTce_Q1aDSCh18P6q_` |
| `OPENAI_API_KEY` | API key owned by the OpenAI project service account |
| `OPENAI_MODEL` | Optional; defaults to `gpt-5.6-terra` |

Never place these values in `.gs` files or commit them. Rotate the access token that was previously pasted into chat, update `.env.local`, and deploy a new Apps Script version.

## Required sheets and columns

The execution spreadsheet must contain:

- `GOALS`, `MILESTONES`, `TASKS`, `TASK_CONTEXT`, `PROGRESS_GATES`, `CHANGE_EVENTS`, `PEOPLE`.
- `TASK_UPDATES` for the append-only command journal.
- `SESSION_HANDOFFS` for structured session close state.
- `NOTIFICATIONS` for push delivery and acknowledgement.
- `PLAYBOOKS` is optional but is added to GPT context when referenced by `TASK_CONTEXT`.
- `NOW` is optional.

Required write columns:

```text
TASKS:
TASK_ID, OWNER, STATUS, LAST_UPDATED

PEOPLE:
PERSON_ID, NAME, ACTIVE

TASK_UPDATES:
UPDATE_ID, DATE_TIME, AUTHOR, TASK_ID, UPDATE_TYPE, FACT_OR_COMMENT,
AFFECTS_TASKS, EVIDENCE_REF, CONFIDENCE, IMPACT_LEVEL, ROUTE_EFFECT,
NEEDS_KOSTYA

SESSION_HANDOFFS:
SESSION_ID, CLOSED_AT, AUTHOR, FOCUS_REF, TOUCHED_REFS, WHAT_DONE,
CURRENT_STATE, WHAT_REMAINS, NEXT_ACTION, WAITING_OR_BLOCKER, NEXT_CHECK,
HANDOFF, EVIDENCE_REFS, FIXATION_ID, SYNC_STATUS, LAST_UPDATED

NOTIFICATIONS:
NOTIFICATION_ID, RECIPIENT_ID, ACK_AT
```

Recommended optional columns:

```text
TASKS: WAITING_FOR, NEXT_CHECK_DATE, RESULT
TASK_UPDATES: SYNC_STATUS, LAST_UPDATED
NOTIFICATIONS: READ_AT, LAST_UPDATED
```

Headers must be in the first row and use the exact names above.

## Deploy

1. Replace the existing read-only code with `Code.gs`.
2. Add Apps Script files named `task-commands.gs` and `drive-context.gs` and paste their repository versions.
3. Enable **Show `appsscript.json` manifest file in editor** and replace it with this folder's manifest.
4. Add Script Properties.
5. Select `authorizeGarmentWidget` in the editor, click **Run**, and approve Spreadsheet, Drive and external-request permissions. Docs and Slides are read as plain text through Google Drive export, so separate Document/Presentation scopes are not required. A successful execution returns `ok: true`, a positive `masterPromptCharacters`, `openAiHttp: 200`, and `model: gpt-5.6-terra`.
6. Select **Deploy → Manage deployments → Edit**.
7. Choose **New version**, execute as **Me**, access **Anyone** (the endpoint is protected by `ACCESS_TOKEN`).
8. Deploy and retain the `/exec` URL.
9. Put that URL and the same new access token in the widget backend environment:

```text
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_ACCESS_TOKEN=...
```

Saving code without creating a new deployment version does not update the live `/exec` endpoint.

## Smoke tests

Health/capabilities:

```bash
curl -sS "$APPS_SCRIPT_WEB_APP_URL" \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$APPS_SCRIPT_ACCESS_TOKEN\",\"action\":\"health\"}"
```

The response must contain:

```json
{
  "ok": true,
  "capabilities": {
    "taskCommands": true,
    "driveContext": true,
    "notificationAck": true,
    "verifiedWrites": true
  }
}
```

Dashboard read:

```bash
curl -sS "$APPS_SCRIPT_WEB_APP_URL" \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$APPS_SCRIPT_ACCESS_TOKEN\",\"action\":\"dashboard\"}"
```

Test task writes on a disposable test task before using production tasks. A successful command returns `commandResult.syncStatus = SYNCED`; the backend rejects any other status.

## Write guarantees

- GPT returns a strict JSON-schema mutation plan; it does not receive arbitrary range-write access.
- Before GPT runs, the gateway reads core rules/state plus task-related Docs, Sheets, Slides and text files from `DRIVE_ROOT_FOLDER_ID`. Binary files are represented by metadata and a Drive link.
- The script applies only explicitly coded task fields.
- `TASK_UPDATES.UPDATE_ID` is derived from `commandId` and is the command idempotency key.
- The mutation plan is persisted in `TASK_UPDATES.ROUTE_EFFECT` before the task row changes.
- A retry restores a partial mutation from that persisted plan.
- `SYNCED` is set only after a verification read.
- `SESSION_HANDOFFS.SESSION_ID` prevents duplicate session-close rows.
- Notification ACK writes only `ACK_AT`, optional `READ_AT`, and `LAST_UPDATED` after recipient verification.
