// dd/mm/yyyy formatters for user-facing date display. HTML <input type="date">
// values stay as YYYY-MM-DD because the spec requires it; the browser still
// renders them in the visitor's locale.

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats a date as `dd/mm/yyyy` in the runtime's local time zone. */
export function formatDate(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Formats a date as `dd/mm/yyyy HH:MM` in the runtime's local time zone. */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
