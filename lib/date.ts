const MOSCOW_TIME_ZONE = "Europe/Moscow";

export function nowInMoscow(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
}

export function parseDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const russian = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (russian) {
    return new Date(Date.UTC(Number(russian[3]), Number(russian[2]) - 1, Number(russian[1])));
  }
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string): string {
  const date = parseDate(value);
  if (!date) return value || "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export function dateKey(value: string): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function daysUntil(value: string): number | null {
  const target = parseDate(value);
  if (!target) return null;
  const today = nowInMoscow();
  today.setUTCHours(0, 0, 0, 0);
  target.setUTCHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

export function isPastDeadline(value: string): boolean {
  const deadline = parseDate(value);
  if (!deadline) return false;
  const today = nowInMoscow();
  today.setUTCHours(0, 0, 0, 0);
  deadline.setUTCHours(0, 0, 0, 0);
  return deadline.getTime() < today.getTime();
}

export function isoNow(): string {
  return new Date().toISOString();
}
