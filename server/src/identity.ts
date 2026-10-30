export function normalizeLoginName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
}

export function normalizeChoirName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
}
