import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const outputPath = join(directory, "GB_WIDGET_ALL_IN_ONE.local.gs");

const requiredEnvironment = ["APPS_SCRIPT_ACCESS_TOKEN", "OPENAI_API_KEY"];
for (const name of requiredEnvironment) {
  if (!String(process.env[name] || "").trim()) {
    throw new Error(`${name} не указан в .env.local`);
  }
}

const config = {
  ACCESS_TOKEN: process.env.APPS_SCRIPT_ACCESS_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5.6-terra",
  EXECUTION_SPREADSHEET_ID:
    process.env.GOOGLE_EXECUTION_SPREADSHEET_ID || "1LfhEpCwKrWTww8SvTUVrIofX1bJ1QmU0m7gbruZB0Qg",
  CONTROL_SPREADSHEET_ID:
    process.env.GOOGLE_CONTROL_SPREADSHEET_ID || "1d-ZL0cAaVA7b17gTcKVvf4fIHuo1p8n7873qBRbwQpw",
  MASTER_PROMPT_DOCUMENT_ID:
    process.env.GOOGLE_MASTER_PROMPT_DOCUMENT_ID || "1_EBiiqM_7c0FxpXbmfZpAg1-POaftWRm26EIvSflwJk",
  DRIVE_ROOT_FOLDER_ID:
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1X4Qe4giI3mEnPUZTce_Q1aDSCh18P6q_"
};

const sourceNames = ["Code.gs", "task-commands.gs", "drive-context.gs"];
const sources = await Promise.all(
  sourceNames.map((name) => readFile(join(directory, name), "utf8"))
);

const header = `/**
 * GARMENT BURO Widget — test all-in-one Apps Script.
 * Generated locally by npm run apps-script:bundle.
 * Contains secrets: do not commit or share this file.
 */
var GB_INLINE_CONFIG_ = ${JSON.stringify(config, null, 2)};
`;

const bundle = [header, ...sources].join("\n\n");
await writeFile(outputPath, bundle, { encoding: "utf8", mode: 0o600 });

console.log("Создан apps-script/GB_WIDGET_ALL_IN_ONE.local.gs");
console.log("Скопируйте его целиком в единственный файл Code.gs и создайте новую версию deployment.");
