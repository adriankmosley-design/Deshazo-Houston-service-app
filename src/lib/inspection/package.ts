/**
 * The inspection package: one zip with every unit inspection report, the
 * Inspection Report Overview (summary) and the Crane Master List, saved in the
 * job's Inspection reports folder as "Inspection Package {job}.zip".
 *
 * A small note kept beside the job's files (not listed as a file) records when
 * the package was emailed, so each completed job is only sent once.
 */
import { zipSync } from 'fflate'
import { BUCKET, supabase, uploadToJob, type JobFile } from '../supabase'
import { masterPdfName } from './master'

export const PACKAGE_RECIPIENTS = ['amosley@deshazo.com', 'pmcallister@deshazo.com']

export const packageName = (jobNumber: string) => `Inspection Package ${jobNumber}.zip`
const sentPath = (jobId: string) => `${jobId}/package-sent.json`

/** How long the emailed download link keeps working. */
export const LINK_DAYS = 30

type JobInfo = { id: string; job_number: string }
export type Sent = { at: string; to: string[] }

const isUnit = (n: string) => /^D\d{6}\b/i.test(n) && /\.pdf$/i.test(n)
const isOverview = (n: string) => /^Inspection Report Overview\b/i.test(n) && /\.pdf$/i.test(n)

/** The files that go in the zip, in the order they are packed: summary, master list, then unit reports. */
export function packageFiles(jobNumber: string, files: JobFile[]) {
  const master = masterPdfName(jobNumber).toLowerCase()
  const overview = files.filter((f) => isOverview(f.file_name))
  const list = files.filter((f) => f.file_name.toLowerCase() === master)
  const units = files.filter((f) => isUnit(f.file_name)).sort((a, b) => a.file_name.localeCompare(b.file_name))
  return { overview, list, units, all: [...overview, ...list, ...units] }
}

export type PackageResult = { ok: true; file: JobFile; count: number } | { ok: false; message: string }

/** Build (or rebuild) the zip and save it in the job's Inspection reports folder. */
export async function makePackage(job: JobInfo): Promise<PackageResult> {
  const { data, error } = await supabase.from('job_files').select('*').eq('job_id', job.id)
  if (error) return { ok: false, message: error.message }
  const files = (data ?? []) as JobFile[]
  const p = packageFiles(job.job_number, files)
  if (!p.units.length) return { ok: false, message: 'No unit inspection reports in this job yet.' }
  if (!p.overview.length) return { ok: false, message: 'Make the inspection report overview first.' }
  if (!p.list.length) return { ok: false, message: 'The crane master list PDF is missing. Remake the overview first.' }

  const entries: Record<string, Uint8Array> = {}
  for (const f of p.all) {
    const { data: blob, error: dl } = await supabase.storage.from(BUCKET).download(f.storage_path)
    if (dl || !blob) return { ok: false, message: `Could not open ${f.file_name}: ${dl?.message ?? 'missing'}` }
    let name = f.file_name
    for (let i = 2; entries[name]; i++) name = f.file_name.replace(/(\.pdf)?$/i, ` (${i})$1`)
    entries[name] = new Uint8Array(await blob.arrayBuffer())
  }
  // PDFs are already compressed, so store them as they are (fast, same size).
  const zip = zipSync(entries, { level: 0 })

  const name = packageName(job.job_number)
  const old = files.filter((f) => f.file_name.toLowerCase() === name.toLowerCase())
  if (old.length) {
    await supabase.storage.from(BUCKET).remove(old.map((f) => f.storage_path))
    await supabase.from('job_files').delete().in('id', old.map((f) => f.id))
  }
  const err = await uploadToJob(job.id, new File([zip as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' }), 'Inspection reports')
  if (err) return { ok: false, message: err }
  const { data: saved } = await supabase.from('job_files').select('*').eq('job_id', job.id).eq('file_name', name).limit(1)
  const file = (saved?.[0] ?? null) as JobFile | null
  if (!file) return { ok: false, message: 'The zip was saved but could not be found again.' }
  return { ok: true, file, count: p.all.length }
}

/** A download link for the package that works without signing in, for LINK_DAYS days. */
export async function packageLink(file: JobFile): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET)
    .createSignedUrl(file.storage_path, LINK_DAYS * 24 * 3600, { download: file.file_name })
  return data?.signedUrl ?? null
}

export async function loadSent(jobId: string): Promise<Sent | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(sentPath(jobId))
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as Sent
  } catch {
    return null
  }
}

export async function markSent(jobId: string, to: string[] = PACKAGE_RECIPIENTS): Promise<string | null> {
  const path = sentPath(jobId)
  await supabase.storage.from(BUCKET).remove([path])
  const body = JSON.stringify({ at: new Date().toISOString(), to } satisfies Sent)
  const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([body], { type: 'application/json' }), { contentType: 'application/json' })
  return error ? error.message : null
}

const COMPLETED = 'Closed' // Completed, Ready to Invoice and Invoiced all sync in as Closed.
const isInspection = (notes: string | null) => {
  const first = (notes ?? '').split('\n')[0]
  return first.includes(':') && /inspect/i.test(first.slice(0, first.indexOf(':')))
}

/** Only jobs whose overview was made on or after this date get emailed (older jobs were backfilled). */
export const PACKAGE_START = '2026-11-23T00:00:00Z'

export type Pending = { id: string; job_number: string; customer: string }

/** Completed inspection jobs that have their overview but whose package has not been emailed yet. */
export async function pendingPackages(): Promise<Pending[]> {
  const jobs: (Pending & { notes: string | null })[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('jobs').select('id,job_number,customer,notes').eq('status', COMPLETED).range(from, from + 999)
    jobs.push(...((data ?? []) as typeof jobs))
    if (!data || data.length < 1000) break
  }
  const out: Pending[] = []
  for (const j of jobs.filter((x) => isInspection(x.notes))) {
    const { data } = await supabase.from('job_files').select('file_name').eq('job_id', j.id).ilike('file_name', 'Inspection Report Overview%').gte('created_at', PACKAGE_START)
    if (!data?.length || (await loadSent(j.id))) continue
    out.push({ id: j.id, job_number: j.job_number, customer: j.customer })
  }
  return out
}

/**
 * Used by the daily email task in the signed-in Job Files tab:
 *   await jobFilesPackages.pending()          -> jobs to send
 *   await jobFilesPackages.prepare(job)       -> { link, count, name } after zipping
 *   await jobFilesPackages.markSent(job.id)   -> after the email has gone out
 */
export const packageTools = {
  recipients: PACKAGE_RECIPIENTS,
  pending: pendingPackages,
  async prepare(job: JobInfo) {
    const r = await makePackage(job)
    if (!r.ok) return { ok: false, message: r.message }
    const link = await packageLink(r.file)
    return link ? { ok: true, link, count: r.count, name: r.file.file_name, days: LINK_DAYS } : { ok: false, message: 'Could not make a download link.' }
  },
  markSent: (jobId: string) => markSent(jobId),
}
