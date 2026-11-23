/** Hours math for the total hours report (kept apart from the PDF code so pages stay light). */
/** One time entry as the sync sends it: tech, work day (YYYY-MM-DD), and clock in/out ("YYYY-MM-DDTHH:MM"). */
export type TimeEntry = { tech: string; date: string; start: string; end: string }
export type HoursRow = TimeEntry & { total: number; regular: number; overtime: number }

export const REG_START = 7
export const REG_END = 15

const minutesOfDay = (t: string) => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16))
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Split one entry into regular (Monday to Friday, 7 AM to 3 PM) and overtime hours.
 * Saturday and Sunday are all overtime. Overnight shifts roll past midnight.
 */
export function splitHours(e: TimeEntry): HoursRow {
  const s = minutesOfDay(e.start)
  let end = minutesOfDay(e.end)
  const days = Math.round((Date.parse(e.end.slice(0, 10)) - Date.parse(e.start.slice(0, 10))) / 86_400_000)
  end += Math.max(0, days) * 1440
  if (end < s) end += 1440
  const total = (end - s) / 60
  let regular = 0
  const first = Date.parse(e.start.slice(0, 10) + 'T00:00:00Z')
  for (let d = 0; d * 1440 < end; d++) {
    const dow = new Date(first + d * 86_400_000).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const a = Math.max(s, d * 1440 + REG_START * 60)
    const b = Math.min(end, d * 1440 + REG_END * 60)
    if (b > a) regular += (b - a) / 60
  }
  return { ...e, total: round2(total), regular: round2(regular), overtime: round2(total - regular) }
}

export function hoursRows(entries: TimeEntry[]): HoursRow[] {
  return entries
    .filter((e) => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(e.start) && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(e.end))
    .map(splitHours)
    .sort((a, b) => a.date.localeCompare(b.date) || a.tech.localeCompare(b.tech) || a.start.localeCompare(b.start))
}


const fmt = (n: number) => n.toFixed(2)

/** One line for the job notes, e.g. "Total hours: 45.50 (39.50 regular, 6.00 overtime)". */
export function hoursSummary(entries: TimeEntry[]): string | null {
  const rows = hoursRows(entries)
  if (!rows.length) return null
  const t = (k: 'total' | 'regular' | 'overtime') => rows.reduce((a, r) => a + r[k], 0)
  return `Total hours: ${fmt(t('total'))} (${fmt(t('regular'))} regular, ${fmt(t('overtime'))} overtime)`
}

/** The total hours number from a job's notes, if the sync has added it. */
export function totalHoursFromNotes(notes: string | null | undefined): string | null {
  const m = (notes ?? '').match(/^Total hours: ([\d.]+)/m)
  return m ? m[1] : null
}

/** Total, regular and overtime hours from a job's notes, if the sync has added them. */
export function hoursFromNotes(notes: string | null | undefined): { total: string; regular: string; overtime: string } | null {
  const m = (notes ?? '').match(/^Total hours: ([\d.]+) \(([\d.]+) regular, ([\d.]+) overtime\)/m)
  return m ? { total: m[1], regular: m[2], overtime: m[3] } : null
}
