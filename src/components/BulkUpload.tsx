import { useRef, useState } from 'react'
import { DUPLICATE, matchJob, supabase, uploadToJob } from '../lib/supabase'

type Result = { name: string; job?: string; ok: boolean; skipped?: boolean; message?: string }

/**
 * Upload many files at once. Each file goes to the job whose number appears
 * in its name, e.g. "Service Report 0292239.pdf" goes to job 0292239.
 */
export default function BulkUpload({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [dragging, setDragging] = useState(false)

  async function run(files: File[]) {
    if (!files.length) return
    setBusy(true)
    setResults([])
    const { data: jobs, error } = await supabase.from('jobs').select('id, job_number').limit(5000)
    if (error || !jobs) {
      setResults([{ name: 'Could not load jobs', ok: false, message: error?.message }])
      setBusy(false)
      return
    }
    const out: Result[] = []
    for (const file of files) {
      const job = matchJob(file.name, jobs)
      if (!job) {
        out.push({ name: file.name, ok: false, message: 'No job number in the name matches a job' })
      } else {
        const err = await uploadToJob(job.id, file)
        out.push({ name: file.name, job: job.job_number, ok: !err, skipped: err === DUPLICATE, message: err ?? undefined })
      }
      setResults([...out])
    }
    setBusy(false)
    onDone()
  }

  const added = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => !r.ok && !r.skipped)

  return (
    <div
      className={`card dropzone stack tight ${dragging ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!busy) run(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="row between wrap gap">
        <div>
          <strong>Upload files</strong>
          <p className="muted small">
            Drag files here. Each one goes to the job whose number is in its file name,
            for example "Service Report 0292239.pdf".
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? `Uploading… ${results.length}` : 'Choose files'}
        </button>
      </div>
      <input ref={inputRef} type="file" multiple hidden
        onChange={(e) => { run(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      {results.length > 0 && !busy && (
        <div className="stack tight bulk-results" role="status">
          <div className="row between">
            <strong>{added} file{added === 1 ? '' : 's'} added to jobs{skipped ? `, ${skipped} already there (skipped)` : ''}</strong>
            <button className="btn small ghost" onClick={() => setResults([])}>Close</button>
          </div>
          {failed.length > 0 && (
            <ul className="uploads small">
              {failed.map((r, i) => (
                <li key={i} className="error">⚠ {r.name}: {r.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
