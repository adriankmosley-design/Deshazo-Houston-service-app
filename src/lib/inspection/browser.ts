/**
 * Makes the inspection report overview inside Job Files: reads the unit
 * inspection PDFs and the inspection ticket saved in a job, builds the combined
 * report, and saves it to the job's Inspection reports folder.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import bannerUrl from '../../assets/inspection-banner.png'
import { BUCKET, supabase, uploadToJob, type JobFile } from '../supabase'
import { makeReport, readSources, type Env, type Source } from './assemble'
import { buildMasterList, masterList, type MasterRow } from './report'
import { masterPdfName, storeMaster } from './master'
import type { RawImage } from './pdfText'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export const OVERVIEW_PREFIX = 'Inspection Report Overview'
export const overviewName = (jobNumber: string) => `${OVERVIEW_PREFIX} ${jobNumber}.pdf`

/** A unit report as Beloved Robot names it ("D000017 ..."), or as the sync saves it. */
export const isUnitFile = (name: string) => /^D\d{6}\b/i.test(name) && /\.pdf$/i.test(name)
/** The inspection ticket is the work order's service report. */
export const isTicketFile = (name: string) => /service[ _-]*report|inspection-015|ticket/i.test(name) && /\.pdf$/i.test(name) && !isUnitFile(name)

function toJpeg(img: RawImage, max = 900) {
  const s = Math.min(1, max / Math.max(img.width, img.height))
  const src = document.createElement('canvas')
  src.width = img.width
  src.height = img.height
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
  const out = document.createElement('canvas')
  out.width = Math.round(img.width * s)
  out.height = Math.round(img.height * s)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return { src: out.toDataURL('image/jpeg', 0.8), width: out.width, height: out.height }
}

const env: Env = {
  open: async (data) => (await pdfjs.getDocument({ data, verbosity: 0, isOffscreenCanvasSupported: false }).promise) as never,
  jpeg: toJpeg,
  ops: pdfjs.OPS,
}

async function bannerDataUrl(): Promise<string> {
  const blob = await (await fetch(bannerUrl)).blob()
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(blob)
  })
}

type JobInfo = { id: string; job_number: string; customer: string; site_address: string | null }

/** Replace any file in the job with this exact name, then save the new one. */
async function replaceFile(job: JobInfo, all: JobFile[], name: string, data: ArrayBuffer) {
  const old = all.filter((f) => f.file_name.toLowerCase() === name.toLowerCase())
  if (old.length) {
    await supabase.storage.from(BUCKET).remove(old.map((f) => f.storage_path))
    await supabase.from('job_files').delete().in('id', old.map((f) => f.id))
  }
  return uploadToJob(job.id, new File([data], name, { type: 'application/pdf' }), 'Inspection reports')
}

/** Pin the crane master list on the job and save its printable PDF. */
async function saveMaster(job: JobInfo, all: JobFile[], rows: MasterRow[], banner: string) {
  const err = await storeMaster(job.id, { jobNumber: job.job_number, made: new Date().toISOString(), rows })
  if (err) return err
  const pdf = buildMasterList({ rows, jobNumber: job.job_number, customer: job.customer, banner }).output('arraybuffer')
  return replaceFile(job, all, masterPdfName(job.job_number), pdf)
}

async function jobFiles(jobId: string) {
  const { data, error } = await supabase.from('job_files').select('*').eq('job_id', jobId)
  return { all: (data ?? []) as JobFile[], error }
}

async function download(files: JobFile[]): Promise<Source[] | string> {
  const out: Source[] = []
  for (const f of files) {
    const { data, error: dl } = await supabase.storage.from(BUCKET).download(f.storage_path)
    if (dl || !data) return `Could not open ${f.file_name}: ${dl?.message ?? 'missing'}`
    out.push({ name: f.file_name, data: new Uint8Array(await data.arrayBuffer()) })
  }
  return out
}

/** Make just the crane master list from the unit reports already in the job (text only, quick). */
export async function makeMasterList(job: JobInfo): Promise<string | null> {
  const { all, error } = await jobFiles(job.id)
  if (error) return error.message
  const units = all.filter((f) => isUnitFile(f.file_name))
  if (!units.length) return 'No unit inspection reports in this job.'
  const src = await download(units)
  if (typeof src === 'string') return src
  const { units: parsed } = await readSources(env, src, false)
  if (!parsed.length) return 'Could not read the unit inspection reports.'
  return saveMaster(job, all, masterList(parsed), await bannerDataUrl())
}

export type OverviewResult = { ok: true; units: number; repairs: number; problems: string[] } | { ok: false; message: string }

/**
 * Build (or rebuild) a job's inspection overview from the unit reports already in the job.
 * `replace` swaps out an existing overview; otherwise an existing one is left alone.
 */
export async function makeOverview(job: { id: string; job_number: string; customer: string; site_address: string | null }, replace = false): Promise<OverviewResult> {
  const { data: files, error } = await supabase.from('job_files').select('*').eq('job_id', job.id)
  if (error) return { ok: false, message: error.message }
  const all = (files ?? []) as JobFile[]
  const units = all.filter((f) => isUnitFile(f.file_name))
  if (!units.length) return { ok: false, message: 'No unit inspection reports (D###### PDFs) in this job yet.' }
  const existing = all.filter((f) => f.file_name.toLowerCase() === overviewName(job.job_number).toLowerCase())
  if (existing.length && !replace) return { ok: false, message: 'This job already has an inspection overview.' }
  const ticket = all.find((f) => isTicketFile(f.file_name))

  const sources: Source[] = []
  for (const f of [...units, ...(ticket ? [ticket] : [])]) {
    const { data, error: dl } = await supabase.storage.from(BUCKET).download(f.storage_path)
    if (dl || !data) return { ok: false, message: `Could not open ${f.file_name}: ${dl?.message ?? 'missing'}` }
    sources.push({ name: f.file_name, data: new Uint8Array(await data.arrayBuffer()) })
  }

  let made
  try {
    made = await makeReport(env, sources, { jobNumber: job.job_number, customer: job.customer, address: job.site_address }, await bannerDataUrl())
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }

  if (existing.length) {
    await supabase.storage.from(BUCKET).remove(existing.map((f) => f.storage_path))
    await supabase.from('job_files').delete().in('id', existing.map((f) => f.id))
  }
  const file = new File([made.pdf], overviewName(job.job_number), { type: 'application/pdf' })
  const err = await uploadToJob(job.id, file, 'Inspection reports')
  if (err) return { ok: false, message: err }
  await saveMaster(job, (await jobFiles(job.id)).all, made.master, await bannerDataUrl())
  await supabase.from('jobs').update({ updated_at: new Date().toISOString() }).eq('id', job.id)
  return { ok: true, units: made.units, repairs: made.repairs, problems: made.problems }
}
