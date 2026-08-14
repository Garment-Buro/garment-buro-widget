/**
 * GARMENT BURO Widget API entrypoint.
 *
 * Deploy this project as a Web app that executes as the script owner.
 * Do not put credentials in this file. Configure Script Properties listed in
 * apps-script/README.md, then deploy a new version after every code change.
 */

var GB_GATEWAY_VERSION_ = "1.1.0";

var GB_EXECUTION_SHEETS_ = {
  goals: "GOALS",
  milestones: "MILESTONES",
  tasks: "TASKS",
  taskContexts: "TASK_CONTEXT",
  progressGates: "PROGRESS_GATES",
  changeEvents: "CHANGE_EVENTS",
  people: "PEOPLE",
  notifications: "NOTIFICATIONS",
  now: "NOW"
};

var GB_CONTROL_SHEETS_ = {
  issues: "ISSUES"
};

function doGet() {
  return jsonResponse_({
    ok: false,
    error: "Use the protected dashboard connection."
  });
}

function doPost(event) {
  try {
    var payload = parseRequestPayload_(event);
    validateAccessToken_(payload.token);
    var action = String(payload.action || "dashboard").trim();

    if (action === "dashboard") {
      return jsonResponse_(buildDashboardPayload_());
    }
    if (action === "taskCommand") {
      return jsonResponse_(handleTaskCommandRequest_(payload));
    }
    if (action === "notificationAck") {
      return jsonResponse_(handleNotificationAckRequest_(payload));
    }
    if (action === "health") {
      return jsonResponse_({ ok: true, capabilities: gatewayCapabilities_() });
    }

    throw new Error("Неизвестное действие gateway: " + action);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: errorText_(error),
      generatedAt: new Date().toISOString()
    });
  }
}

function buildDashboardPayload_() {
  var execution = readSource_(
    requiredProperty_("EXECUTION_SPREADSHEET_ID"),
    GB_EXECUTION_SHEETS_,
    ["now", "notifications"]
  );
  var control = readSource_(
    requiredProperty_("CONTROL_SPREADSHEET_ID"),
    GB_CONTROL_SHEETS_,
    []
  );

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    data: mergeObjects_(execution.data, control.data),
    sourceErrors: {
      execution: execution.error,
      control: control.error
    },
    notificationsError: execution.optionalErrors.notifications || null,
    capabilities: gatewayCapabilities_()
  };
}

function handleNotificationAckRequest_(payload) {
  var request = payload && payload.request || {};
  var notificationId = safeRequiredText_(request.notificationId, "NOTIFICATION_ID", 120);
  var recipientId = safeRequiredText_(request.recipientId, "RECIPIENT_ID", 120);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = openExecutionSpreadsheet_();
    var sheet = requireSheet_(spreadsheet, "NOTIFICATIONS");
    var notification = findRecord_(sheet, "NOTIFICATION_ID", notificationId);
    if (!notification) throw new Error("Уведомление " + notificationId + " не найдено.");
    if (normalizeText_(notification.RECIPIENT_ID) !== normalizeText_(recipientId)) {
      throw new Error("Получатель уведомления не совпадает с текущим пользователем.");
    }

    var acknowledgedAt = String(notification.ACK_AT || "").trim() || nowText_();
    if (!String(notification.ACK_AT || "").trim()) {
      var headers = headers_(sheet);
      setCellByHeader_(sheet, notification.__rowNumber, headers, "ACK_AT", acknowledgedAt);
      if (headers.indexOf("READ_AT") >= 0 && !String(notification.READ_AT || "").trim()) {
        setCellByHeader_(sheet, notification.__rowNumber, headers, "READ_AT", acknowledgedAt);
      }
      if (headers.indexOf("LAST_UPDATED") >= 0) {
        setCellByHeader_(sheet, notification.__rowNumber, headers, "LAST_UPDATED", acknowledgedAt);
      }
      SpreadsheetApp.flush();
    }

    var verified = findRecord_(sheet, "NOTIFICATION_ID", notificationId);
    if (!verified || !String(verified.ACK_AT || "").trim()) {
      throw new Error("Verification read: ACK_AT уведомления не записан.");
    }

    return {
      ok: true,
      notificationAck: {
        notificationId: notificationId,
        recipientId: recipientId,
        acknowledgedAt: verified.ACK_AT,
        syncStatus: "SYNCED"
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function readSource_(spreadsheetId, sheets, optionalKeys) {
  var data = {};
  var errors = [];
  var optionalErrors = {};
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);

  Object.keys(sheets).forEach(function (key) {
    try {
      var sheet = spreadsheet.getSheetByName(sheets[key]);
      if (!sheet) throw new Error("Не найдена вкладка " + sheets[key]);
      data[key] = sheet.getDataRange().getDisplayValues();
    } catch (error) {
      data[key] = [];
      if (optionalKeys.indexOf(key) >= 0) optionalErrors[key] = errorText_(error);
      else errors.push(sheets[key] + ": " + errorText_(error));
    }
  });

  return {
    data: data,
    error: errors.length ? errors.join("; ") : null,
    optionalErrors: optionalErrors
  };
}

function gatewayCapabilities_() {
  return {
    version: GB_GATEWAY_VERSION_,
    dashboardRead: true,
    driveContext: true,
    taskCommands: true,
    notificationAck: true,
    verifiedWrites: true,
    idempotentCommands: true,
    sessionHandoffs: true
  };
}

function parseRequestPayload_(event) {
  var text = event && event.postData ? event.postData.contents : "{}";
  var payload = JSON.parse(text || "{}");
  if (!payload || typeof payload !== "object") throw new Error("Некорректный JSON запроса.");
  return payload;
}

function validateAccessToken_(token) {
  var expected = requiredProperty_("ACCESS_TOKEN");
  if (!token || !constantTimeEqual_(String(token), expected)) throw new Error("Unauthorized");
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function requiredProperty_(name) {
  var value = String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
  if (!value) throw new Error(name + " не указан в Apps Script Properties.");
  return value;
}

function safeRequiredText_(value, label, maxLength) {
  var text = String(value || "").trim();
  if (!text) throw new Error(label + " не указан.");
  if (text.length > maxLength) throw new Error(label + " слишком длинный.");
  return text;
}

function normalizeText_(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function mergeObjects_(left, right) {
  var result = {};
  Object.keys(left || {}).forEach(function (key) { result[key] = left[key]; });
  Object.keys(right || {}).forEach(function (key) { result[key] = right[key]; });
  return result;
}

function errorText_(error) {
  return String(error && error.message ? error.message : error);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
