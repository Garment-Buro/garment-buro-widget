const env: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

export const spreadsheetConfig = {
  executionId:
    env.GOOGLE_EXECUTION_SPREADSHEET_ID ||
    "1LfhEpCwKrWTww8SvTUVrIofX1bJ1QmU0m7gbruZB0Qg",
  controlId:
    env.GOOGLE_CONTROL_SPREADSHEET_ID ||
    "1d-ZL0cAaVA7b17gTcKVvf4fIHuo1p8n7873qBRbwQpw"
};

export const dashboardConfig = {
  dataSource: env.DASHBOARD_DATA_SOURCE || "mock",
  launchGoalId: env.DASHBOARD_GOAL_ID || "GOAL-002",
  personName: env.DASHBOARD_PERSON_NAME || "Вера",
  refreshMs: Number(env.DASHBOARD_REFRESH_MS) || 60_000,
  snapshotPath: env.DASHBOARD_SNAPSHOT_PATH || ".data/dashboard-google-snapshot.json"
};

export const appsScriptConfig = {
  webAppUrl: env.APPS_SCRIPT_WEB_APP_URL || "",
  accessToken: env.APPS_SCRIPT_ACCESS_TOKEN || ""
};

export const googleDriveConfig = {
  rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "1X4Qe4giI3mEnPUZTce_Q1aDSCh18P6q_"
};
