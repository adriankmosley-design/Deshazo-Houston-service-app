import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-key',
)

export const BUCKET = 'job-files'

export const STATUSES = ['Open', 'Quoted', 'In progress', 'Closed'] as const
export type Status = (typeof STATUSES)[number]

export const CATEGORIES = [
  'Service reports',
  'Inspection reports',
  'Quotes',
  'Parts pricing',
  'Photos',
  'Letters',
  'Emails',
  'Other',
] as const
export type Category = (typeof CATEGORIES)[number]

export type Job = {
  id: string
  job_number: string
  customer: string
  site_address: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  crane_make: string | null
  capacity: string | null
  serial_number: string | null
  status: Status
  notes: string | null
  created_at: string
  updated_at: string
}

export type JobFile = {
  id: string
  job_id: string
  category: Category
  file_name: string
  storage_path: string
  size_bytes: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

/** Guess a folder for a file from its name and type, so uploads land in the right place. */
export function guessCategory(file: File): Category {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return 'Photos'
  if (/inspect|osha|annual|frequent|periodic/.test(name)) return 'Inspection reports'
  if (/service[\s_-]*report|work[\s_-]*order|repair[\s_-]*ticket/.test(name)) return 'Service reports'
  if (/quote|estimate|proposal/.test(name)) return 'Quotes'
  if (/price|pricing|parts|bom/.test(name)) return 'Parts pricing'
  if (/letter|ltr/.test(name)) return 'Letters'
  if (/\.(eml|msg)$/.test(name)) return 'Emails'
  return 'Other'
}

export function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Storage keys must be plain ASCII; keep the readable part of the name. */
export function safeFileName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-120)
}

/** Find the job a file belongs to from a job number in its name, e.g. "Service Report 0292239.pdf". */
export function matchJob<T extends { job_number: string }>(fileName: string, jobs: T[]): T | undefined {
  const runs = (fileName.match(/\d{4,}/g) ?? []).map((d) => d.replace(/^0+/, ''))
  return jobs.find((j) => {
    const num = j.job_number.replace(/\D/g, '').replace(/^0+/, '')
    return num.length >= 4 && runs.includes(num)
  })
}

/**
 * Job numbers mentioned in a piece of text, most likely first. Deshazo vendor POs are
 * written PO-job (e.g. "291722-R291012"), so the second number of such a pair comes first.
 */
export function jobNumbersIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(\d{6})-R?(\d{6,7})\b/gi)) out.push(m[2], m[1])
  for (const m of text.matchAll(/\d{4,}/g)) out.push(m[0])
  return [...new Set(out.map((d) => d.replace(/^0+/, '')))]
}

/** The job a piece of text is about, checking job numbers in the order jobNumbersIn gives. */
export function matchJobText<T extends { job_number: string }>(text: string, jobs: T[]): T | undefined {
  const byNum = new Map(jobs.map((j) => [j.job_number.replace(/\D/g, '').replace(/^0+/, ''), j]))
  for (const n of jobNumbersIn(text)) {
    const hit = n.length >= 4 ? byNum.get(n) : undefined
    if (hit) return hit
  }
  return undefined
}

/** Upload one file into a job's folder and record it. Returns an error message, or null when it worked. */
export async function uploadToJob(jobId: string, file: File, category?: Category): Promise<string | null> {
  const path = `${jobId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (up.error) return up.error.message
  const { data: user } = await supabase.auth.getUser()
  const row = await supabase.from('job_files').insert({
    job_id: jobId, category: category ?? guessCategory(file), file_name: file.name, storage_path: path,
    size_bytes: file.size, mime_type: file.type || null, uploaded_by: user.user?.email ?? null,
  })
  if (row.error) {
    await supabase.storage.from(BUCKET).remove([path])
    return row.error.message
  }
  return null
}
