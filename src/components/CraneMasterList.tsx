import { useEffect, useState } from 'react'
import { loadMaster, type MasterList } from '../lib/inspection/master'
import type { Job, JobFile } from '../lib/supabase'

const isUnit = (f: JobFile) => /^D\d{6}\b.*\.pdf$/i.test(f.file_name)

/** The crane master list, pinned at the top of a job. Made from the job's inspection reports. */
export default function CraneMasterList({ job, files, onMade }: { job: Job; files: JobFile[]; onMade: () => void }) {
  const [list, setList] = useState<MasterList | null | undefined>(undefined)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(true)
  const units = files.filter(isUnit).length

  useEffect(() => {
    let live = true
    loadMaster(job.id).then((m) => { if (live) setList(m) })
    return () => { live = false }
  }, [job.id, files.length])

  async function make() {
    setMsg('Making the crane master list…')
    const { makeMasterList } = await import('../lib/inspection/browser')
    const err = await makeMasterList(job)
    setMsg(err ?? '')
    setList(await loadMaster(job.id))
    onMade()
  }

  // A job with unit reports but no list yet gets one made on first open.
  useEffect(() => {
    if (list === null && units > 0 && !msg) make()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, units])

  if (!list && !msg) return null
  const rows = list?.rows ?? []
  const repairs = rows.filter((r) => r.repairs).length

  return (
    <section className="card stack tight master-list">
      <div className="row between wrap gap">
        <div>
          <h2>📌 Crane master list</h2>
          <p className="muted small">
            {rows.length ? `${rows.length} unit${rows.length === 1 ? '' : 's'}${repairs ? `, ${repairs} with repair items` : ', no repair items'}${rows[0]?.date ? ` · inspected ${rows[0].date}` : ''}` : msg}
          </p>
        </div>
        <div className="row gap">
          {rows.length > 0 && <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>}
          {units > 0 && <button className="btn small ghost" disabled={msg.startsWith('Making')} onClick={make}>Remake</button>}
        </div>
      </div>
      {open && rows.length > 0 && (
        <div className="table-wrap">
          <table className="master">
            <thead>
              <tr><th>D#</th><th>Description</th><th>Structure</th><th>Location</th><th>Manufacturer</th><th>Serial #</th><th>Capacity</th><th>Model #</th><th>Repairs</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.repairs ? 'has-repairs' : ''}>
                  <td><strong>{r.id}</strong></td><td>{r.description}</td><td>{r.structure}</td><td>{r.location}</td>
                  <td>{r.manufacturer}</td><td>{r.serial}</td><td>{r.capacity}</td><td>{r.model}</td><td>{r.repairs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
