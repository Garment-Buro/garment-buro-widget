/**
 * Task-scoped Google Drive context for GPT commands.
 *
 * Apps Script executes as the deployment owner, so no Google service-account
 * JSON is stored here. Configure DRIVE_ROOT_FOLDER_ID in Script Properties.
 */

var GB_DRIVE_FOLDER_MIME_ = "application/vnd.google-apps.folder";
var GB_DRIVE_DOC_MIME_ = "application/vnd.google-apps.document";
var GB_DRIVE_SHEET_MIME_ = "application/vnd.google-apps.spreadsheet";
var GB_DRIVE_SLIDES_MIME_ = "application/vnd.google-apps.presentation";
var GB_DRIVE_MAX_INDEXED_ = 240;
var GB_DRIVE_MAX_SELECTED_ = 7;
var GB_DRIVE_MAX_FILE_CHARS_ = 16000;
var GB_DRIVE_MAX_CONTEXT_CHARS_ = 55000;

function buildDriveTaskContext_(request, task, taskContext) {
  var rootFolderId = requiredProperty_("DRIVE_ROOT_FOLDER_ID");
  var index = driveFileIndex_(rootFolderId);
  var selected = rankDriveFiles_(index.files, request, task, taskContext).slice(0, GB_DRIVE_MAX_SELECTED_);
  var warnings = index.truncated ? ["Индекс Drive ограничен первыми " + GB_DRIVE_MAX_INDEXED_ + " файлами."] : [];
  var files = [];
  var remaining = GB_DRIVE_MAX_CONTEXT_CHARS_;

  selected.forEach(function (metadata) {
    if (remaining <= 0) return;
    var limit = Math.min(GB_DRIVE_MAX_FILE_CHARS_, remaining);
    try {
      var content = readDriveFileContent_(metadata, request, task, limit);
      files.push(driveContextFile_(metadata, content, content ? "READ" : "METADATA_ONLY"));
      remaining -= content.length;
    } catch (error) {
      warnings.push("Не удалось прочитать «" + metadata.name + "»: " + errorText_(error));
      files.push(driveContextFile_(metadata, "", "READ_ERROR"));
    }
  });

  return {
    rootFolderId: rootFolderId,
    files: files,
    warnings: warnings
  };
}

function driveFileIndex_(rootFolderId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = "gb-drive-index-v2-" + rootFolderId;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) { /* rebuild */ }
  }

  var files = [];
  var queue = [{ id: rootFolderId, path: "", depth: 0 }];
  var truncated = false;
  while (queue.length && files.length < GB_DRIVE_MAX_INDEXED_) {
    var folderRef = queue.shift();
    var folder = DriveApp.getFolderById(folderRef.id);
    var childFolders = folder.getFolders();
    while (childFolders.hasNext()) {
      var childFolder = childFolders.next();
      var childPath = joinDrivePath_(folderRef.path, childFolder.getName());
      if (folderRef.depth < 3 && !isArchiveDrivePath_(childPath)) {
        queue.push({ id: childFolder.getId(), path: childPath, depth: folderRef.depth + 1 });
      }
    }

    var childFiles = folder.getFiles();
    while (childFiles.hasNext()) {
      if (files.length >= GB_DRIVE_MAX_INDEXED_) {
        truncated = true;
        break;
      }
      var file = childFiles.next();
      files.push({
        id: file.getId(),
        name: file.getName(),
        mimeType: file.getMimeType(),
        modifiedTime: file.getLastUpdated().toISOString(),
        url: file.getUrl(),
        path: joinDrivePath_(folderRef.path, file.getName())
      });
    }
  }
  if (queue.length) truncated = true;
  var result = { files: files, truncated: truncated };
  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch (error) { /* index can exceed cache item limit */ }
  return result;
}

function rankDriveFiles_(files, request, task, taskContext) {
  var canonicalText = JSON.stringify(taskContext || {});
  var explicitText = normalizeText_(canonicalText + " " + String(request.details && request.details.note || ""));
  var terms = uniqueDriveTerms_([
    request.taskId,
    task.TASK,
    task.WHY_NOW,
    request.author,
    canonicalText,
    request.details && request.details.note
  ]);

  return files.map(function (file) {
    var title = normalizeText_(file.name);
    var explicit = explicitText.indexOf(normalizeText_(file.id)) >= 0 || explicitText.indexOf(title) >= 0;
    var score = explicit ? 100 : 0;
    if (["00_ПРАВИЛА РАБОТЫ С БАЗОЙ", "00_СОСТОЯНИЕ ПРОЕКТА"].indexOf(file.name) >= 0) score += 70;
    if (title.indexOf(normalizeText_(request.taskId)) >= 0) score += 60;
    terms.forEach(function (term) {
      if (title.indexOf(term) >= 0) score += term.length > 8 ? 8 : 3;
    });
    if (file.mimeType === GB_DRIVE_DOC_MIME_) score += 2;
    if (isArchiveDrivePath_(file.path) && !explicit) score -= 200;
    if (file.name === "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ") score -= 200;
    if (file.id === requiredProperty_("EXECUTION_SPREADSHEET_ID")) score -= 200;
    return { file: file, score: score };
  }).filter(function (entry) {
    return entry.score > 0;
  }).sort(function (left, right) {
    if (left.score !== right.score) return right.score - left.score;
    return left.file.name.localeCompare(right.file.name);
  }).map(function (entry) {
    return entry.file;
  });
}

function readDriveFileContent_(metadata, request, task, limit) {
  var content = "";
  if (metadata.mimeType === GB_DRIVE_DOC_MIME_) {
    content = exportGoogleWorkspaceText_(metadata.id);
  } else if (metadata.mimeType === GB_DRIVE_SHEET_MIME_) {
    content = readRelevantSpreadsheetText_(metadata.id, request, task);
  } else if (metadata.mimeType === GB_DRIVE_SLIDES_MIME_) {
    content = exportGoogleWorkspaceText_(metadata.id);
  } else if (/^text\//.test(metadata.mimeType) || /json|csv|xml|markdown/.test(metadata.mimeType)) {
    content = DriveApp.getFileById(metadata.id).getBlob().getDataAsString("UTF-8");
  }
  return truncateDriveText_(content, limit);
}

function exportGoogleWorkspaceText_(fileId) {
  var url = "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) +
    "/export?mimeType=" + encodeURIComponent("text/plain");
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(
      "Google Drive export failed (HTTP " + status + "): " +
      response.getContentText().slice(0, 300)
    );
  }
  return response.getContentText("UTF-8");
}

function readRelevantSpreadsheetText_(spreadsheetId, request, task) {
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var terms = uniqueDriveTerms_([request.taskId, request.author, task.TASK]);
  var sections = [];
  spreadsheet.getSheets().slice(0, 5).forEach(function (sheet) {
    var lastRow = Math.min(sheet.getLastRow(), 250);
    var lastColumn = Math.min(sheet.getLastColumn(), 26);
    if (!lastRow || !lastColumn) return;
    var values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
    var relevant = values.filter(function (row, index) {
      if (index === 0) return true;
      var text = normalizeText_(row.join(" "));
      return terms.some(function (term) { return text.indexOf(term) >= 0; });
    }).slice(0, 40);
    if (relevant.length > 1) {
      sections.push("[" + sheet.getName() + "]\n" + relevant.map(function (row) { return row.join("\t"); }).join("\n"));
    }
  });
  return sections.join("\n\n");
}

function driveContextFile_(metadata, content, contentStatus) {
  return {
    id: metadata.id,
    title: metadata.name,
    mimeType: metadata.mimeType,
    modifiedTime: metadata.modifiedTime,
    url: metadata.url,
    path: metadata.path,
    content: content,
    contentStatus: contentStatus
  };
}

function uniqueDriveTerms_(parts) {
  var seen = {};
  var terms = [];
  parts.forEach(function (part) {
    normalizeText_(part).split(/[^a-zа-яё0-9_-]+/i).forEach(function (term) {
      if (term.length >= 4 && !seen[term]) {
        seen[term] = true;
        terms.push(term);
      }
    });
  });
  return terms;
}

function isArchiveDrivePath_(path) {
  return /(^|\s\/\s|_)архив($|\s\/\s|\s|—)/i.test(String(path || ""));
}

function joinDrivePath_(parent, name) {
  return [parent, name].filter(function (value) { return Boolean(value); }).join(" / ");
}

function truncateDriveText_(value, limit) {
  var text = String(value || "").replace(/^\uFEFF/, "").trim();
  return text.length > limit ? text.slice(0, limit) + "\n[…обрезано gateway по лимиту контекста…]" : text;
}
