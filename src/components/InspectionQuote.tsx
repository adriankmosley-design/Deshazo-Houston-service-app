import { useState } from 'react'
import type { Job, JobFile } from '../lib/supabase'

const isUnit = (name: string) => /^D\d{6}\b/i.test(name) && /\.pdf$/i.test(name)

/** "Make repair quote" button in the Inspection quotes folder: prices the repair items on the unit reports. */
export default function InspectionQuote({ job, files, onMade }: { job: Job; files: JobFile[]; onMade: () => void }) {
  const [msg, setMsg] = useState('')
  if (!files.some((f) => isUnit(f.file_name))) return null
  const has = files.some((f) => f.file_name.toLowerCase() === `repair quote ${job.job_number}.pdf`)

  async function make() {
    setMsg('Building the repair quote…')
    const { makeQuote } = await import('../lib/inspection/browser')
    const r = await makeQuote(job, true)
    setMsg(r.ok
      ? `Done: ${r.lines} repair line${r.lines === 1 ? '' : 's'}, total $${r.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Check the hours and parts before sending.`
      : r.message)
    onMade()
  }

  return (
    <div className="row gap wrap small">
      <button className="btn small" disabled={msg.startsWith('Building')} onClick={make}>
        {has ? 'Remake repair quote' : 'Make repair quote'}
      </button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  )
}
