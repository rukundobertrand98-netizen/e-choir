export function csvCell(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
