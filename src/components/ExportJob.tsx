import { useState } from 'react'
import type { Job } from '../lib/supabase'

/** One button that downloads everything in the job (all folders, files and job details) as a zip. */
export default function ExportJob({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function run() {
    setBusy(true)
    setMsg('Getting files…')
    try {
      const { exportJob, exportName } = await import('../lib/exportJob')
      const r = await exportJob(job, (d, t) => setMsg(t ? `Getting files… ${d} of ${t}` : 'Zipping…'))
      setMsg(
        r.ok
          ? `Downloaded ${exportName(job.job_number)} (${r.count} files + job details).` +
              (r.skipped.length ? ` ${r.skipped.length} could not be opened, listed inside.` : '')
          : r.message,
      )
    } catch (e) {
      setMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button className="btn" disabled={busy} onClick={run} title="Download every file and the job details as one zip">
        {busy ? 'Exporting…' : '⬇ Export job'}
      </button>
      {msg && <span className="muted small">{msg}</span>}
    </div>
  )
}
