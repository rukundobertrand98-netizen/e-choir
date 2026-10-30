export function dateTimeLocalToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  const desired = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  )
  let instant = desired

  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, Number(part.value)]),
      )
      const represented = Date.UTC(
        parts.year!,
        parts.month! - 1,
        parts.day!,
        parts.hour!,
        parts.minute!,
      )
      const adjustment = desired - represented
      if (!adjustment) break
      instant += adjustment
    }

    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    )
    if (
      values.year !== Number(year) ||
      values.month !== Number(month) ||
      values.day !== Number(day) ||
      values.hour !== Number(hour) ||
      values.minute !== Number(minute)
    ) {
      return null
    }
    return new Date(instant).toISOString()
  } catch {
    return null
  }
}

export function isoToDateTimeLocal(value: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
