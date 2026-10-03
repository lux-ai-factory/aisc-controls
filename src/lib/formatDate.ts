// dd/mm/yyyy formatters for dates shown to people. The value of an HTML
// <input type="date"> stays YYYY-MM-DD, the only format it accepts; the browser
// still shows it in the visitor's locale.

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats a date as `dd/mm/yyyy` in the runtime's local time zone. */
export function formatDate(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Formats a date as `dd/mm/yyyy HH:MM` in the runtime's local time zone. */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
