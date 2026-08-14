import "server-only";

import { googleDriveConfig } from "@/lib/config";
import { googleApiFetch } from "@/lib/google/service-account";
import type { TaskAssistantClientContext } from "@/lib/ai/types";

const driveReadonlyScope = "https://www.googleapis.com/auth/drive.readonly";
const sheetsReadonlyScope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const presentationsReadonlyScope = "https://www.googleapis.com/auth/presentations.readonly";
const folderMimeType = "application/vnd.google-apps.folder";
const documentMimeType = "application/vnd.google-apps.document";
const spreadsheetMimeType = "application/vnd.google-apps.spreadsheet";
const presentationMimeType = "application/vnd.google-apps.presentation";
const coreDocumentTitles = new Set([
  "00_ПРАВИЛА РАБОТЫ С БАЗОЙ",
  "00_СОСТОЯНИЕ ПРОЕКТА"
]);
const maxIndexedFiles = 300;
const maxSelectedFiles = 7;
const maxFileCharacters = 16_000;
const maxContextCharacters = 55_000;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  path: string;
};

export type DriveContextFile = {
  id: string;
  title: string;
  mimeType: string;
  modifiedTime: string;
  url: string;
  path: string;
  content: string;
  contentStatus: "READ" | "METADATA_ONLY" | "READ_ERROR";
};

export type RelevantDriveContext = {
  rootFolderId: string;
  files: DriveContextFile[];
  warnings: string[];
};

let indexCache: { expiresAt: number; files: DriveFile[]; truncated: boolean } | null = null;

export async function buildRelevantDriveContext(
  context: TaskAssistantClientContext,
  requestText = ""
): Promise<RelevantDriveContext> {
  const index = await listDriveTree();
  const selected = rankDriveFiles(index.files, context, requestText).slice(0, maxSelectedFiles);
  const warnings = index.truncated
    ? [`Индекс Drive ограничен первыми ${maxIndexedFiles} файлами.`]
    : [];
  let remainingCharacters = maxContextCharacters;
  const files: DriveContextFile[] = [];

  for (const file of selected) {
    if (remainingCharacters <= 0) break;
    const limit = Math.min(maxFileCharacters, remainingCharacters);
    try {
      const content = await readDriveFileText(file, context, limit);
      files.push(toContextFile(file, content, content ? "READ" : "METADATA_ONLY"));
      remainingCharacters -= content.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Не удалось прочитать «${file.name}»: ${message}`);
      files.push(toContextFile(file, "", "READ_ERROR"));
    }
  }

  return { rootFolderId: googleDriveConfig.rootFolderId, files, warnings };
}

export async function readGoogleDocumentText(documentId: string, title: string): Promise<string> {
  const response = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}/export?mimeType=text%2Fplain`,
    [driveReadonlyScope],
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) throw new Error(`Не удалось прочитать актуальный документ «${title}» (${response.status}).`);
  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error(`Документ «${title}» пуст или недоступен.`);
  return text;
}

export async function readGoogleSheetRecords(
  spreadsheetId: string,
  sheetTitle: string,
  range = "A1:Z2000"
): Promise<Record<string, string>[]> {
  const encodedRange = encodeURIComponent(`'${sheetTitle.replace(/'/g, "''")}'!${range}`);
  const response = await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
    [sheetsReadonlyScope],
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) throw new Error(`Не удалось прочитать лист ${sheetTitle} (${response.status}).`);
  const payload = await response.json() as { values?: string[][] };
  const [rawHeaders = [], ...body] = payload.values || [];
  const headers = rawHeaders.map((header) => String(header).replace(/^\uFEFF/, "").trim());
  return body
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] || "").trim()])));
}

async function listDriveTree() {
  if (indexCache && indexCache.expiresAt > Date.now()) return indexCache;
  const files: DriveFile[] = [];
  const folders = [{ id: googleDriveConfig.rootFolderId, path: "" }];
  let truncated = false;

  while (folders.length && files.length < maxIndexedFiles) {
    const folder = folders.shift()!;
    const children = await listFolderChildren(folder.id, folder.path);
    for (const child of children) {
      if (files.length >= maxIndexedFiles) {
        truncated = true;
        break;
      }
      if (child.mimeType === folderMimeType) {
        if (!isArchivePath(child.path)) folders.push({ id: child.id, path: child.path });
      } else {
        files.push(child);
      }
    }
  }

  indexCache = { expiresAt: Date.now() + 5 * 60_000, files, truncated };
  return indexCache;
}

async function listFolderChildren(folderId: string, parentPath: string): Promise<DriveFile[]> {
  const result: DriveFile[] = [];
  let pageToken = "";
  do {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const tokenQuery = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=100&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)&supportsAllDrives=true&includeItemsFromAllDrives=true${tokenQuery}`,
      [driveReadonlyScope],
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw new Error(`Drive folder read failed (${response.status}).`);
    const payload = await response.json() as { nextPageToken?: string; files?: Omit<DriveFile, "path">[] };
    for (const file of payload.files || []) {
      result.push({ ...file, path: [parentPath, file.name].filter(Boolean).join(" / ") });
    }
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return result;
}

function rankDriveFiles(files: DriveFile[], context: TaskAssistantClientContext, requestText: string) {
  const canonicalText = context.taskContext?.canonicalRefs.join(" ") || "";
  const explicitText = normalize(`${canonicalText} ${requestText}`);
  const searchTerms = uniqueTerms([
    context.task.id,
    context.task.title,
    context.task.whyNow,
    context.taskContext?.currentWorkingState || "",
    canonicalText,
    requestText,
    ...context.relatedTasks.map((task) => `${task.id} ${task.title}`)
  ]);

  return files
    .map((file) => {
      const title = normalize(file.name);
      const fileId = normalize(file.id);
      const explicit = explicitText.includes(fileId) || explicitText.includes(title);
      let score = explicit ? 100 : 0;
      if (coreDocumentTitles.has(file.name)) score += 70;
      if (title.includes(normalize(context.task.id))) score += 60;
      for (const term of searchTerms) if (title.includes(term)) score += term.length > 8 ? 8 : 3;
      if (file.mimeType === documentMimeType) score += 2;
      if (isArchivePath(file.path) && !explicit) score -= 200;
      if (file.name === "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ") score -= 200;
      if (file.id === "1LfhEpCwKrWTww8SvTUVrIofX1bJ1QmU0m7gbruZB0Qg") score -= 200;
      return { file, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.name.localeCompare(right.file.name, "ru"))
    .map((entry) => entry.file);
}

async function readDriveFileText(
  file: DriveFile,
  context: TaskAssistantClientContext,
  limit: number
): Promise<string> {
  if (file.mimeType === documentMimeType) {
    return truncate(await readGoogleDocumentText(file.id, file.name), limit);
  }
  if (file.mimeType === spreadsheetMimeType) {
    return truncate(await readSpreadsheetText(file, context), limit);
  }
  if (file.mimeType === presentationMimeType) {
    return truncate(await readPresentationText(file.id), limit);
  }
  if (file.mimeType.startsWith("text/") || /json|csv|xml|markdown/.test(file.mimeType)) {
    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
      [driveReadonlyScope],
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw new Error(`Drive file download failed (${response.status}).`);
    return truncate(await response.text(), limit);
  }
  return "";
}

async function readSpreadsheetText(file: DriveFile, context: TaskAssistantClientContext): Promise<string> {
  const metadata = await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}?includeGridData=false&fields=sheets.properties.title`,
    [sheetsReadonlyScope],
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!metadata.ok) throw new Error(`Spreadsheet metadata failed (${metadata.status}).`);
  const payload = await metadata.json() as { sheets?: Array<{ properties?: { title?: string } }> };
  const terms = uniqueTerms([context.task.id, context.task.title, context.personName]);
  const sections: string[] = [];
  for (const title of (payload.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean).slice(0, 5) as string[]) {
    const encodedRange = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:Z250`);
    const response = await googleApiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
      [sheetsReadonlyScope],
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) continue;
    const values = (await response.json() as { values?: string[][] }).values || [];
    const relevantRows = values.filter((row, index) => index === 0 || terms.some((term) => normalize(row.join(" ")).includes(term)));
    if (relevantRows.length > 1) sections.push(`[${title}]\n${relevantRows.slice(0, 40).map((row) => row.join("\t")).join("\n")}`);
  }
  return sections.join("\n\n");
}

async function readPresentationText(fileId: string): Promise<string> {
  const response = await googleApiFetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`,
    [driveReadonlyScope, presentationsReadonlyScope],
    { signal: AbortSignal.timeout(30_000) }
  );
  if (response.ok) {
    const payload = await response.json() as { slides?: unknown[] };
    const text: string[] = [];
    walkJson(payload.slides || [], (value, key) => {
      if (key === "content" && typeof value === "string" && value.trim()) text.push(value.trim());
    });
    return text.join("\n");
  }

  return readPresentationTextFromDriveExport(fileId, response.status);
}

async function readPresentationTextFromDriveExport(fileId: string, slidesStatus: number) {
  const exportMime = encodeURIComponent("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const response = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${exportMime}`,
    [driveReadonlyScope],
    { signal: AbortSignal.timeout(45_000) }
  );
  const presentationBytes = response.ok
    ? await response.arrayBuffer()
    : await downloadGoogleWorkspaceFileLro(fileId, decodeURIComponent(exportMime), slidesStatus, response.status);

  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(presentationBytes);
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  const slides: string[] = [];
  for (const [index, name] of slideNames.entries()) {
    const xml = await archive.file(name)?.async("text");
    const text = extractOpenXmlText(xml || "");
    if (text) slides.push(`[Слайд ${index + 1}]\n${text}`);
  }
  return slides.join("\n\n");
}

async function downloadGoogleWorkspaceFileLro(
  fileId: string,
  mimeType: string,
  slidesStatus: number,
  exportStatus: number
): Promise<ArrayBuffer> {
  const response = await googleApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/download?mimeType=${encodeURIComponent(mimeType)}`,
    [driveReadonlyScope],
    { method: "POST", headers: { "Content-Length": "0" }, signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) {
    throw new Error(`Presentation read failed (Slides ${slidesStatus}; export ${exportStatus}; LRO ${response.status}).`);
  }

  let operation = await response.json() as DriveDownloadOperation;
  const delays = [1_000, 2_000, 4_000, 8_000];
  for (const delay of delays) {
    if (operation.done) break;
    await wait(delay);
    const poll = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/${operation.name}`,
      [driveReadonlyScope],
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!poll.ok) throw new Error(`Drive LRO poll failed (${poll.status}).`);
    operation = await poll.json() as DriveDownloadOperation;
  }
  if (!operation.done || operation.error) {
    throw new Error(operation.error?.message || "Drive LRO did not complete in time.");
  }
  const downloadUri = operation.response?.downloadUri;
  if (!downloadUri) throw new Error("Drive LRO returned no downloadUri.");
  const download = await googleApiFetch(
    downloadUri,
    [driveReadonlyScope],
    { redirect: "follow", signal: AbortSignal.timeout(60_000) }
  );
  if (!download.ok) throw new Error(`Drive LRO content download failed (${download.status}).`);
  return download.arrayBuffer();
}

type DriveDownloadOperation = {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: { downloadUri?: string };
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function walkJson(value: unknown, visit: (value: unknown, key: string) => void, key = "") {
  visit(value, key);
  if (Array.isArray(value)) value.forEach((item) => walkJson(item, visit, key));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => walkJson(child, visit, childKey));
  }
}

function slideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function extractOpenXmlText(xml: string) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean)
    .join("\n");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function toContextFile(file: DriveFile, content: string, contentStatus: DriveContextFile["contentStatus"]): DriveContextFile {
  return {
    id: file.id,
    title: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime || "",
    url: file.webViewLink || `https://drive.google.com/open?id=${file.id}`,
    path: file.path,
    content,
    contentStatus
  };
}

function uniqueTerms(parts: string[]) {
  const terms = parts
    .flatMap((part) => normalize(part).split(/[^a-zа-яё0-9_-]+/i))
    .filter((term) => term.length >= 4);
  return [...new Set(terms)];
}

function normalize(value: string) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

function isArchivePath(path: string) {
  return /(^|\s\/\s|_)архив($|\s\/\s|\s|—)/i.test(path);
}

function truncate(value: string, limit: number) {
  const text = value.replace(/^\uFEFF/, "").trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[…обрезано backend по лимиту контекста…]` : text;
}
