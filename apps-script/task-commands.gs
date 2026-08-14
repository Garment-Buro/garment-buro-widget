/**
 * GARMENT BURO task-command write gateway.
 *
 * Add this file to the Apps Script project that currently serves dashboard reads,
 * then route payload.action === "taskCommand" to handleTaskCommandRequest_(payload).
 * Secrets belong in Script Properties, never in the desktop bundle:
 * OPENAI_API_KEY, OPENAI_MODEL, ACCESS_TOKEN, EXECUTION_SPREADSHEET_ID,
 * MASTER_PROMPT_DOCUMENT_ID.
 */

var GB_TASK_STATUSES_ = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "WAITING_EXTERNAL",
  "BLOCKED",
  "REVIEW",
  "DONE",
  "CANCELLED"
];

function handleTaskCommandRequest_(payload) {
  var request = payload && payload.request;
  if (!request || !request.commandId || !request.taskId || !request.intent) {
    throw new Error("Некорректная taskCommand-команда.");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = openExecutionSpreadsheet_();
    var tasksSheet = requireSheet_(spreadsheet, "TASKS");
    var updatesSheet = requireSheet_(spreadsheet, "TASK_UPDATES");
    var handoffsSheet = requireSheet_(spreadsheet, "SESSION_HANDOFFS");
    var task = findRecord_(tasksSheet, "TASK_ID", request.taskId);
    if (!task) throw new Error("Задача " + request.taskId + " не найдена.");

    var duplicate = findRecord_(updatesSheet, "UPDATE_ID", updateIdForCommand_(request.commandId));
    var requestedSession = request.intent === "session_close" && request.details && request.details.sessionId
      ? findRecord_(handoffsSheet, "SESSION_ID", request.details.sessionId)
      : null;
    if (duplicate) {
      return recoverCommandWrite_(tasksSheet, updatesSheet, handoffsSheet, request, task, duplicate, requestedSession);
    }
    if (requestedSession && requestedSession.SYNC_STATUS === "SYNCED") {
      return {
        ok: true,
        commandResult: buildCommandResult_(request, task.STATUS, "SYNCED", "Рабочая сессия уже закрыта и не продублирована.")
      };
    }
    if (requestedSession && requestedSession.FIXATION_ID) {
      var previousUpdate = findRecord_(updatesSheet, "UPDATE_ID", updateIdForCommand_(requestedSession.FIXATION_ID));
      if (previousUpdate) {
        return recoverCommandWrite_(tasksSheet, updatesSheet, handoffsSheet, request, task, previousUpdate, requestedSession);
      }
    }

    var plan = askGptForTaskPlan_(request, task, spreadsheet);
    plan = validateTaskPlan_(request, task, plan);
    var sessionRow = null;

    if (request.intent === "session_close") {
      var sessionId = String(request.details && request.details.sessionId || "").trim();
      if (!sessionId) throw new Error("Для закрытия сессии нужен SESSION_ID.");
      sessionRow = requestedSession || findRecord_(handoffsSheet, "SESSION_ID", sessionId);
      if (!sessionRow) {
        appendSessionHandoff_(handoffsSheet, request, plan, "PENDING_CAPTURE");
        sessionRow = findRecord_(handoffsSheet, "SESSION_ID", sessionId);
      }
    }

    try {
      appendTaskUpdate_(updatesSheet, request, task, plan);
      if (plan.targetStatus !== "UNCHANGED" && plan.targetStatus !== task.STATUS) {
        updateTaskFromPlan_(tasksSheet, task.__rowNumber, plan);
      }

      verifyCommandWrite_(tasksSheet, updatesSheet, request, plan);
      if (sessionRow) updateSessionSyncStatus_(handoffsSheet, sessionRow.__rowNumber, "SYNCED");
      return {
        ok: true,
        commandResult: buildCommandResult_(request, plan.targetStatus === "UNCHANGED" ? task.STATUS : plan.targetStatus, "SYNCED", plan.assistantMessage)
      };
    } catch (writeError) {
      if (sessionRow) updateSessionSyncStatus_(handoffsSheet, sessionRow.__rowNumber, "PARTIAL_SYNC");
      throw writeError;
    }
  } finally {
    lock.releaseLock();
  }
}

function recoverCommandWrite_(tasksSheet, updatesSheet, handoffsSheet, request, task, update, sessionRow) {
  var snapshot = readPlanSnapshot_(update);
  if (!snapshot || !snapshot.plan) {
    throw new Error("Partial recovery: в TASK_UPDATES нет сохранённого mutation plan.");
  }
  var plan = snapshot.plan;
  if (plan.targetStatus !== "UNCHANGED" && plan.targetStatus !== task.STATUS) {
    updateTaskFromPlan_(tasksSheet, task.__rowNumber, plan);
  }
  if (request.intent === "session_close" && !sessionRow) {
    appendSessionHandoff_(handoffsSheet, request, plan, "PENDING_CAPTURE");
    sessionRow = findRecord_(handoffsSheet, "SESSION_ID", request.details.sessionId);
  }
  var verificationRequest = {
    commandId: snapshot.commandId,
    taskId: request.taskId
  };
  verifyCommandWrite_(tasksSheet, updatesSheet, verificationRequest, plan);
  if (sessionRow) updateSessionSyncStatus_(handoffsSheet, sessionRow.__rowNumber, "SYNCED");
  var verifiedTask = findRecord_(tasksSheet, "TASK_ID", request.taskId);
  return {
    ok: true,
    commandResult: buildCommandResult_(
      request,
      verifiedTask && verifiedTask.STATUS || task.STATUS,
      "SYNCED",
      plan.assistantMessage || "Частичная запись восстановлена и проверена без дублей."
    )
  };
}

function askGptForTaskPlan_(request, task, spreadsheet) {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = String(properties.getProperty("OPENAI_API_KEY") || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY не указан в Apps Script Properties.");
  var model = String(properties.getProperty("OPENAI_MODEL") || "gpt-5.6-terra").trim();
  var masterPromptId = String(properties.getProperty("MASTER_PROMPT_DOCUMENT_ID") || "").trim();
  if (!masterPromptId) throw new Error("MASTER_PROMPT_DOCUMENT_ID не указан в Apps Script Properties.");
  var masterPrompt = DocumentApp.openById(masterPromptId).getBody().getText();
  var recentUpdates = recentTaskUpdates_(spreadsheet, request.taskId, request.author, 20);
  var instructions = [
    masterPrompt,
    "RUNTIME CONTRACT TASK COMMAND:",
    "Ты обрабатываешь явную команду сотрудника из desktop widget.",
    "Верни только structured plan. Не утверждай запись до verification read.",
    "Начать всегда означает IN_PROGRESS и START_PLAN.",
    "Застрял означает BLOCKED; Жду означает WAITING_EXTERNAL.",
    "Новый факт означает NEW_FACT: зафиксируй факт в TASK_UPDATES и не меняй статус задачи.",
    "Готово: проверь комментарий и acceptance. Используй DONE только если результат действительно принят правилами; иначе REVIEW или IN_PROGRESS.",
    "Отклонить не означает CANCELLED автоматически: сохрани объяснение и не меняй OWNER/PRIORITY/DEADLINE без разрешённого решения.",
    "Допустимые статусы: " + GB_TASK_STATUSES_.join(", ") + "."
  ].join("\n\n");
  var input = JSON.stringify({
    author: request.author,
    personId: request.personId,
    commandId: request.commandId,
    intent: request.intent,
    comment: request.details && request.details.note,
    nextCheckDate: request.details && request.details.nextCheckDate,
    session: request.details,
    task: task,
    recentTaskUpdates: recentUpdates,
    clientContext: request.context
  });
  var response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: model,
      instructions: instructions,
      input: input,
      max_output_tokens: 1400,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "task_command_plan",
          strict: true,
          schema: taskCommandPlanSchema_()
        }
      }
    })
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("OpenAI API: " + response.getResponseCode() + " " + response.getContentText().slice(0, 500));
  }
  var payload = JSON.parse(response.getContentText());
  var outputText = readOpenAiOutputText_(payload);
  if (!outputText) throw new Error("GPT не вернула structured plan.");
  return JSON.parse(outputText);
}

function taskCommandPlanSchema_() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      assistantMessage: { type: "string" },
      targetStatus: { type: "string", enum: ["UNCHANGED"].concat(GB_TASK_STATUSES_) },
      updateType: { type: "string", enum: ["START_PLAN", "PROGRESS", "NEW_FACT", "BLOCKER", "COMPLETION", "COMMENT"] },
      factOrComment: { type: "string" },
      waitingFor: { type: "string" },
      result: { type: "string" },
      whatDone: { type: "string" },
      currentState: { type: "string" },
      whatRemains: { type: "string" },
      nextAction: { type: "string" },
      waitingOrBlocker: { type: "string" },
      nextCheck: { type: "string" },
      handoff: { type: "string" },
      evidenceRefs: { type: "string" },
      requiresApproval: { type: "boolean" }
    },
    required: [
      "assistantMessage", "targetStatus", "updateType", "factOrComment", "waitingFor", "result",
      "whatDone", "currentState", "whatRemains", "nextAction", "waitingOrBlocker", "nextCheck",
      "handoff", "evidenceRefs", "requiresApproval"
    ]
  };
}

function validateTaskPlan_(request, task, plan) {
  if (!plan || GB_TASK_STATUSES_.indexOf(plan.targetStatus) < 0 && plan.targetStatus !== "UNCHANGED") {
    throw new Error("GPT вернула недопустимый статус задачи.");
  }
  var forcedStatuses = { accept: "IN_PROGRESS", stuck: "BLOCKED", waiting: "WAITING_EXTERNAL" };
  if (forcedStatuses[request.intent]) plan.targetStatus = forcedStatuses[request.intent];
  if (request.intent === "accept") plan.updateType = "START_PLAN";
  if (request.intent === "stuck") plan.updateType = "BLOCKER";
  if (request.intent === "fact") {
    plan.targetStatus = "UNCHANGED";
    plan.updateType = "NEW_FACT";
  }
  if (request.intent === "done") plan.updateType = "COMPLETION";
  if (request.intent === "reject" && plan.targetStatus === "CANCELLED") plan.targetStatus = "UNCHANGED";
  if (plan.requiresApproval && ["DONE", "CANCELLED"].indexOf(plan.targetStatus) >= 0) plan.targetStatus = "REVIEW";
  if (request.intent === "session_start") plan.targetStatus = task.STATUS === "READY" ? "IN_PROGRESS" : "UNCHANGED";
  return plan;
}

function appendTaskUpdate_(sheet, request, task, plan) {
  if (findRecord_(sheet, "UPDATE_ID", updateIdForCommand_(request.commandId))) return;
  var headers = headers_(sheet);
  var row = emptyRow_(headers.length);
  setByHeader_(row, headers, "UPDATE_ID", updateIdForCommand_(request.commandId));
  setByHeader_(row, headers, "DATE_TIME", nowText_());
  setByHeader_(row, headers, "AUTHOR", request.author);
  setByHeader_(row, headers, "TASK_ID", request.taskId);
  setByHeader_(row, headers, "UPDATE_TYPE", plan.updateType);
  setByHeader_(row, headers, "FACT_OR_COMMENT", plan.factOrComment || request.details.note);
  setByHeader_(row, headers, "AFFECTS_TASKS", request.taskId);
  setByHeader_(row, headers, "EVIDENCE_REF", plan.evidenceRefs);
  setByHeader_(row, headers, "CONFIDENCE", "CONFIRMED");
  setByHeader_(row, headers, "IMPACT_LEVEL", "LOCAL");
  setByHeader_(row, headers, "ROUTE_EFFECT", planSnapshotText_(request, plan));
  setByHeader_(row, headers, "NEEDS_KOSTYA", plan.requiresApproval ? "YES" : "NO");
  sheet.appendRow(row);
}

function updateTaskFromPlan_(sheet, rowNumber, plan) {
  var headers = headers_(sheet);
  setCellByHeader_(sheet, rowNumber, headers, "STATUS", plan.targetStatus);
  setCellByHeader_(sheet, rowNumber, headers, "LAST_UPDATED", nowText_());
  if (plan.waitingFor) setCellByHeader_(sheet, rowNumber, headers, "WAITING_FOR", plan.waitingFor);
  else if (["WAITING_EXTERNAL", "BLOCKED"].indexOf(plan.targetStatus) < 0) setCellByHeader_(sheet, rowNumber, headers, "WAITING_FOR", "");
  if (plan.nextCheck) setCellByHeader_(sheet, rowNumber, headers, "NEXT_CHECK_DATE", plan.nextCheck);
  if (plan.result) setCellByHeader_(sheet, rowNumber, headers, "RESULT", plan.result);
}

function appendSessionHandoff_(sheet, request, plan, syncStatus) {
  var headers = headers_(sheet);
  var row = emptyRow_(headers.length);
  var sessionId = request.details.sessionId;
  setByHeader_(row, headers, "SESSION_ID", sessionId);
  setByHeader_(row, headers, "CLOSED_AT", nowText_());
  setByHeader_(row, headers, "AUTHOR", request.author);
  setByHeader_(row, headers, "FOCUS_REF", request.taskId);
  setByHeader_(row, headers, "TOUCHED_REFS", request.taskId);
  setByHeader_(row, headers, "WHAT_DONE", plan.whatDone || request.details.note);
  setByHeader_(row, headers, "CURRENT_STATE", plan.currentState);
  setByHeader_(row, headers, "WHAT_REMAINS", plan.whatRemains);
  setByHeader_(row, headers, "NEXT_ACTION", plan.nextAction);
  setByHeader_(row, headers, "WAITING_OR_BLOCKER", plan.waitingOrBlocker);
  setByHeader_(row, headers, "NEXT_CHECK", plan.nextCheck);
  setByHeader_(row, headers, "HANDOFF", plan.handoff);
  setByHeader_(row, headers, "EVIDENCE_REFS", plan.evidenceRefs);
  setByHeader_(row, headers, "FIXATION_ID", request.commandId);
  setByHeader_(row, headers, "SYNC_STATUS", syncStatus);
  setByHeader_(row, headers, "LAST_UPDATED", nowText_());
  sheet.appendRow(row);
}

function updateSessionSyncStatus_(sheet, rowNumber, status) {
  var headers = headers_(sheet);
  setCellByHeader_(sheet, rowNumber, headers, "SYNC_STATUS", status);
  setCellByHeader_(sheet, rowNumber, headers, "LAST_UPDATED", nowText_());
}

function verifyCommandWrite_(tasksSheet, updatesSheet, request, plan) {
  SpreadsheetApp.flush();
  var update = findRecord_(updatesSheet, "UPDATE_ID", updateIdForCommand_(request.commandId));
  if (!update) throw new Error("Verification read: TASK_UPDATE не найден.");
  var task = findRecord_(tasksSheet, "TASK_ID", request.taskId);
  var expectedStatus = plan.targetStatus === "UNCHANGED" ? task.STATUS : plan.targetStatus;
  if (!task || task.STATUS !== expectedStatus) throw new Error("Verification read: статус TASK не совпал.");
}

function planSnapshotText_(request, plan) {
  return "WIDGET_PLAN:" + JSON.stringify({ commandId: request.commandId, plan: plan });
}

function readPlanSnapshot_(update) {
  var text = String(update && update.ROUTE_EFFECT || "");
  if (text.indexOf("WIDGET_PLAN:") !== 0) return null;
  try {
    var snapshot = JSON.parse(text.slice("WIDGET_PLAN:".length));
    if (!snapshot.commandId || !snapshot.plan) return null;
    return snapshot;
  } catch (error) {
    return null;
  }
}

function buildCommandResult_(request, taskStatus, syncStatus, message) {
  return {
    commandId: request.commandId,
    assistantMessage: message,
    syncStatus: syncStatus,
    taskStatus: taskStatus,
    sessionId: request.details && request.details.sessionId || "",
    updatedAt: new Date().toISOString()
  };
}

function recentTaskUpdates_(spreadsheet, taskId, author, limit) {
  var sheet = requireSheet_(spreadsheet, "TASK_UPDATES");
  return records_(sheet).filter(function (row) {
    return row.TASK_ID === taskId || row.AUTHOR === author;
  }).slice(-limit);
}

function openExecutionSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var id = String(properties.getProperty("EXECUTION_SPREADSHEET_ID") || "").trim();
  if (!id) throw new Error("EXECUTION_SPREADSHEET_ID не указан в Apps Script Properties.");
  return SpreadsheetApp.openById(id);
}

function requireSheet_(spreadsheet, title) {
  var sheet = spreadsheet.getSheetByName(title);
  if (!sheet) throw new Error("Лист " + title + " не найден.");
  return sheet;
}

function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function (value) {
    return String(value).replace(/^\uFEFF/, "").trim();
  });
}

function records_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = headers_(sheet);
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues().map(function (values, index) {
    var record = { __rowNumber: index + 2 };
    headers.forEach(function (header, column) { record[header] = String(values[column] || "").trim(); });
    return record;
  });
}

function findRecord_(sheet, header, value) {
  var target = String(value || "").trim();
  if (!target) return null;
  var rows = records_(sheet);
  for (var i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i][header] === target) return rows[i];
  }
  return null;
}

function setCellByHeader_(sheet, rowNumber, headers, header, value) {
  var index = headers.indexOf(header);
  if (index < 0) throw new Error("Колонка " + header + " не найдена.");
  sheet.getRange(rowNumber, index + 1).setValue(value);
}

function setByHeader_(row, headers, header, value) {
  var index = headers.indexOf(header);
  if (index >= 0) row[index] = value == null ? "" : value;
}

function emptyRow_(length) {
  return Array.apply(null, Array(length)).map(function () { return ""; });
}

function safeId_(value) {
  return String(value).replace(/[^A-Za-z0-9-]/g, "").slice(0, 80);
}

function updateIdForCommand_(commandId) {
  return "TU-" + safeId_(commandId);
}

function nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Moscow", "dd.MM.yyyy HH:mm 'MSK'");
}

function readOpenAiOutputText_(payload) {
  if (payload.output_text) return payload.output_text;
  var output = payload.output || [];
  for (var i = 0; i < output.length; i += 1) {
    var content = output[i].content || [];
    for (var j = 0; j < content.length; j += 1) {
      if (content[j].type === "output_text" && content[j].text) return content[j].text;
    }
  }
  return "";
}
