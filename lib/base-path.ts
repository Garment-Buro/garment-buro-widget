const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";

export const appBasePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export function appPath(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!appBasePath || normalizedPath === appBasePath || normalizedPath.startsWith(`${appBasePath}/`)) {
    return normalizedPath;
  }
  return `${appBasePath}${normalizedPath}`;
}
