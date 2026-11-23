import { useEffect, useState } from 'react'
import type { Job, JobFile } from '../lib/supabase'
import { loadSent, makePackage, packageFiles, packageName, type Sent } from '../lib/inspection/package'

/** "Make inspection package" button: zips the unit reports, the overview and the crane master list. */
export default function InspectionPackage({ job, files, onMade }: { job: Job; files: JobFile[]; onMade: () => void }) {
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const p = packageFiles(job.job_number, files)
  const zip = files.find((f) => f.file_name.toLowerCase() === packageName(job.job_number).toLowerCase())

  useEffect(() => {
    let live = true
    loadSent(job.id).then((s) => { if (live) setSent(s) })
    return () => { live = false }
  }, [job.id, files.length])

  if (!p.units.length || !p.overview.length) return null

  async function make() {
    setMsg('Zipping the inspection package…')
    const r = await makePackage(job)
    setMsg(r.ok ? `Done: ${r.count} files in ${packageName(job.job_number)}.` : r.message)
    onMade()
  }

  return (
    <div className="row gap wrap small">
      <button className="btn small" disabled={msg.startsWith('Zipping')} onClick={make}>
        {zip ? 'Remake inspection package (zip)' : 'Make inspection package (zip)'}
      </button>
      {msg && <span className="muted">{msg}</span>}
      {!msg && sent && (
        <span className="muted">
          Package emailed {new Date(sent.at).toLocaleDateString()} to {sent.to.join(' and ')}.
        </span>
      )}
    </div>
  )
}
