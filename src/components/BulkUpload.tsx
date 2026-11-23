import { useRef, useState } from 'react'
import { BUCKET, guessCategory, matchJob, matchJobText, safeFileName, supabase } from '../lib/supabase'

type Result = { name: string; job?: string; ok: boolean; message?: string }

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
    const [{ data: jobs, error }, { data: user }] = await Promise.all([
      supabase.from('jobs').select('id, job_number').limit(5000),
      supabase.auth.getUser(),
    ])
    if (error || !jobs) {
      setResults([{ name: 'Could not load jobs', ok: false, message: error?.message }])
      setBusy(false)
      return
    }
    const out: Result[] = []
    const { readableFile } = await import('../lib/htmlText')
    for (const original of files) {
      // HTML pages are saved as plain text so anyone can open them on any computer.
      const file = await readableFile(original)
      let job = matchJob(file.name, jobs)
      if (!job) {
        // No job number in the name: look inside the document (header text first).
        const { fileText } = await import('../lib/docText')
        job = matchJobText(await fileText(file), jobs)
      }
      if (!job) {
        out.push({ name: file.name, ok: false, message: 'No job number in the name or the document matches a job' })
        setResults([...out])
        continue
      }
      const path = `${job.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
      })
      if (up.error) {
        out.push({ name: file.name, job: job.job_number, ok: false, message: up.error.message })
      } else {
        const row = await supabase.from('job_files').insert({
          job_id: job.id, category: guessCategory(file), file_name: file.name, storage_path: path,
          size_bytes: file.size, mime_type: file.type || null, uploaded_by: user.user?.email ?? null,
        })
        if (row.error) await supabase.storage.from(BUCKET).remove([path])
        out.push({ name: file.name, job: job.job_number, ok: !row.error, message: row.error?.message })
      }
      setResults([...out])
    }
    setBusy(false)
    onDone()
  }

  const added = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)

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
            Drag files here. Each one goes to the job whose number is in its file name
            (for example "Service Report 0292239.pdf") or, if not, in the document itself,
            such as the header of a PDF or Word file.
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
            <strong>{added} file{added === 1 ? '' : 's'} added to jobs</strong>
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
