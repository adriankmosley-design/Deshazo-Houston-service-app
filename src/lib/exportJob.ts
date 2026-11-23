/**
 * "Export job": one zip with everything in a job file, downloaded to the computer.
 * Each folder becomes a folder in the zip, plus "Job details.txt" (all the job's
 * info and a list of its files) and "Total hours.csv" when time entries exist.
 * Nothing is saved back to the job, so exporting never adds or changes files.
 */
import { zipSync } from 'fflate'
import { BUCKET, CATEGORIES, folderLabel, formatBytes, supabase, type Job, type JobFile } from './supabase'
import { hoursFromNotes, hoursRows } from './hoursCalc'
import { hoursPath, readEntries } from './hours'

export const exportName = (jobNumber: string) => `Job ${jobNumber} export.zip`

const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'file'
const local = (iso: string) => new Date(iso).toLocaleString()
const csv = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

function details(job: Job, files: JobFile[]): string {
  const h = hoursFromNotes(job.notes)
  const inspection = /inspect/i.test((job.notes ?? '').split('\n')[0].split(':')[0])
  const line = (label: string, v: string | null | undefined) => `${label.padEnd(16)}${v?.trim() || '-'}`
  const out = [
    `JOB #${job.job_number}`,
    '',
    line('Customer:', job.customer),
    line('Status:', job.status + (inspection ? ' (Inspection)' : '')),
    line('Site address:', job.site_address),
    line('Contact:', job.contact_name),
    line('Phone:', job.contact_phone),
    line('Email:', job.contact_email),
    line('Crane make:', job.crane_make),
    line('Capacity:', job.capacity),
    line('Serial number:', job.serial_number),
    line('Total hours:', h ? `${h.total} (${h.regular} regular Mon to Fri 7 AM to 3 PM, ${h.overtime} overtime)` : null),
    line('Created:', local(job.created_at)),
    line('Last updated:', local(job.updated_at)),
    line('Exported:', new Date().toLocaleString()),
    '',
    'NOTES',
    job.notes?.trim() || '-',
    '',
    `FILES (${files.length})`,
  ]
  for (const c of CATEGORIES) {
    const list = files.filter((f) => f.category === c)
    if (!list.length) continue
    out.push('', `${folderLabel(c)} (${list.length})`)
    for (const f of list) out.push(`  ${f.file_name}  ·  ${formatBytes(f.size_bytes)}  ·  added ${local(f.created_at)}`)
  }
  return out.join('\r\n') + '\r\n'
}

async function hoursCsv(job: Job): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).download(hoursPath(job.id))
  if (!data) return null
  try {
    const rows = hoursRows(readEntries(await data.text()))
    if (!rows.length) return null
    const t = (s: string) => s.slice(11, 16)
    const lines = [['Tech', 'Date', 'Start', 'End', 'Total hrs', 'Regular hrs', 'Overtime hrs'].join(',')]
    for (const r of rows) lines.push([r.tech, r.date, t(r.start), t(r.end), r.total, r.regular, r.overtime].map(csv).join(','))
    const sum = (k: 'total' | 'regular' | 'overtime') => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100
    lines.push(['Total', '', '', '', sum('total'), sum('regular'), sum('overtime')].map(csv).join(','))
    return lines.join('\r\n') + '\r\n'
  } catch {
    return null
  }
}

export type ExportResult = { ok: true; count: number; skipped: string[] } | { ok: false; message: string }

/** Build the zip in the browser and download it. `progress` is called as each file is fetched. */
export async function exportJob(job: Job, progress: (done: number, total: number) => void): Promise<ExportResult> {
  const { data, error } = await supabase.from('job_files').select('*').eq('job_id', job.id).order('created_at')
  if (error) return { ok: false, message: error.message }
  const files = (data ?? []) as JobFile[]
  const root = clean(`Job ${job.job_number}`)
  const enc = new TextEncoder()
  const entries: Record<string, Uint8Array> = {}
  entries[`${root}/Job details.txt`] = enc.encode(details(job, files))
  const hrs = await hoursCsv(job)
  if (hrs) entries[`${root}/Total hours.csv`] = enc.encode(hrs)

  const skipped: string[] = []
  let done = 0
  progress(0, files.length)
  for (const f of files) {
    const { data: blob, error: dl } = await supabase.storage.from(BUCKET).download(f.storage_path)
    progress(++done, files.length)
    if (dl || !blob) { skipped.push(f.file_name); continue }
    const folder = clean(folderLabel(f.category))
    let bytes = new Uint8Array(await blob.arrayBuffer())
    let fileName = f.file_name
    if (/\.html?$/i.test(fileName)) {
      const { htmlToText, txtName } = await import('./htmlText')
      bytes = enc.encode(htmlToText(new TextDecoder().decode(bytes)))
      fileName = txtName(fileName)
    }
    const base = clean(fileName)
    let name = `${root}/${folder}/${base}`
    for (let i = 2; entries[name]; i++) name = `${root}/${folder}/${base.replace(/(\.[^.]*)?$/, ` (${i})$1`)}`
    entries[name] = bytes
  }
  if (skipped.length) entries[`${root}/Could not export.txt`] = enc.encode(skipped.join('\r\n') + '\r\n')

  // Most job files (PDFs, photos, zips) are already compressed, so store them as they are.
  const zip = zipSync(entries, { level: 0 })
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = exportName(job.job_number)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, count: files.length - skipped.length, skipped }
}
