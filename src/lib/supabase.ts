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
