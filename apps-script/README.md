# Apps Script write gateway

The deployed dashboard endpoint is currently read-only. Add `task-commands.gs` to that Apps Script project and route the command before the existing dashboard-read branch:

```javascript
function doPost(event) {
  try {
    var payload = JSON.parse(event.postData.contents || "{}");
    validateAccessToken_(payload.token); // keep the existing token validation
    if (payload.action === "taskCommand") {
      return jsonResponse_(handleTaskCommandRequest_(payload));
    }
    return jsonResponse_(buildDashboardPayload_()); // keep the existing read implementation
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  }
}
```

Required Script Properties:

- `ACCESS_TOKEN`
- `EXECUTION_SPREADSHEET_ID`
- `MASTER_PROMPT_DOCUMENT_ID`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-5.6-terra`)

Deploy a new web-app version after adding the module. The widget intentionally treats the old read-only response as an error instead of pretending that the task was updated.

The gateway uses the existing `TASK_UPDATES.UPDATE_ID` as the idempotency key and stores the structured mutation plan in `TASK_UPDATES.ROUTE_EFFECT`. `SESSION_HANDOFFS.SESSION_ID` is the session idempotency key. A partial write remains `PENDING_CAPTURE` or `PARTIAL_SYNC`; a retry restores the missing task mutation from the stored plan, performs a verification read, and only then changes `SYNC_STATUS` to `SYNCED`.
