/**
 * The crane master list pinned at the top of a job. It is made with the
 * inspection report overview and kept beside the job's files in storage
 * (not listed as a file), plus a "Crane Master List {job}.pdf" in the
 * Inspection reports folder for printing.
 */
import { BUCKET, supabase } from '../supabase'
import type { MasterRow } from './report'

export type MasterList = { jobNumber: string; made: string; rows: MasterRow[] }

export const masterPath = (jobId: string) => `${jobId}/crane-master-list.json`
export const masterPdfName = (jobNumber: string) => `Crane Master List ${jobNumber}.pdf`

export async function loadMaster(jobId: string): Promise<MasterList | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(masterPath(jobId))
  if (error || !data) return null
  try {
    const m = JSON.parse(await data.text()) as MasterList
    return Array.isArray(m.rows) ? m : null
  } catch {
    return null
  }
}

export async function storeMaster(jobId: string, m: MasterList): Promise<string | null> {
  const path = masterPath(jobId)
  await supabase.storage.from(BUCKET).remove([path])
  const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(m)], { type: 'application/json' }), { contentType: 'application/json' })
  return error ? error.message : null
}
