import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  BUCKET, CATEGORIES, folderLabel, formatBytes, formatDate, guessCategory, safeFileName, supabase,
  type Category, type Job, type JobFile,
} from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import InspectionBadge from '../components/InspectionBadge'
import OutlookEmails from '../components/OutlookEmails'
import CraneMasterList from '../components/CraneMasterList'
import { hoursFromNotes } from '../lib/hoursCalc'
import InspectionPackage from '../components/InspectionPackage'
import ExportJob from '../components/ExportJob'
import InspectionQuote from '../components/InspectionQuote'

type Upload = { name: string; status: 'uploading' | 'done' | 'error'; message?: string }

export default function JobDetail({ userEmail }: { userEmail: string }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [files, setFiles] = useState<JobFile[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [outlookLinks, setOutlookLinks] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [target, setTarget] = useState<'Auto' | Category>('Auto')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [overview, setOverview] = useState('')
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const loadFiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('job_files').select('*').eq('job_id', id).order('created_at', { ascending: false })
    if (error) return setError(error.message)
    const list = (data as JobFile[]) ?? []
    setFiles(list)
    const images = list.filter((f) => f.mime_type?.startsWith('image/'))
    if (images.length) {
      const { data: urls } = await supabase.storage
        .from(BUCKET).createSignedUrls(images.map((f) => f.storage_path), 3600)
      const map: Record<string, string> = {}
      urls?.forEach((u) => { if (u.path && u.signedUrl) map[u.path] = u.signedUrl })
      setThumbs(map)
    }
    // Saved emails: find each one's "Open in Outlook" link so the email name opens it in Outlook.
    const emails = list.filter((f) => f.category === 'Emails' && /\.html?$/i.test(f.file_name))
    const links: Record<string, string> = {}
    await Promise.all(emails.map(async (f) => {
      const { data } = await supabase.storage.from(BUCKET).download(f.storage_path)
      const link = data ? outlookLinkFrom(await data.text()) : null
      if (link) links[f.id] = link
    }))
    setOutlookLinks(links)
  }, [id])

  useEffect(() => {
    supabase.from('jobs').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error) setError(error.message)
      setJob(data as Job)
    })
    loadFiles()
  }, [id, loadFiles])

  async function upload(list: FileList | File[], forced?: Category) {
    const arr = Array.from(list)
    if (!arr.length) return
    setUploads(arr.map((f) => ({ name: f.name, status: 'uploading' })))
    await Promise.all(arr.map(async (file, i) => {
      const category = forced ?? (target === 'Auto' ? guessCategory(file) : target)
      const path = `${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`
      const mark = (u: Partial<Upload>) =>
        setUploads((prev) => prev.map((p, j) => (j === i ? { ...p, ...u } : p)))
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
      })
      if (up.error) return mark({ status: 'error', message: up.error.message })
      const row = await supabase.from('job_files').insert({
        job_id: id, category, file_name: file.name, storage_path: path,
        size_bytes: file.size, mime_type: file.type || null, uploaded_by: userEmail,
      })
      if (row.error) {
        await supabase.storage.from(BUCKET).remove([path])
        return mark({ status: 'error', message: row.error.message })
      }
      mark({ status: 'done' })
    }))
    // Touch the job so it rises to the top of the list.
    await supabase.from('jobs').update({ updated_at: new Date().toISOString() }).eq('id', id)
    await loadFiles()
    setTimeout(() => setUploads((u) => u.filter((x) => x.status === 'error')), 2500)
  }

  const unitReports = files.filter((f) => /^D\d{6}\b.*\.pdf$/i.test(f.file_name))
  const hasOverview = files.some((f) => /^Inspection Report Overview/i.test(f.file_name))
  const hours = hoursFromNotes(job?.notes)
  const hoursFile = files.find((f) => /^Total Hours/i.test(f.file_name))

  async function makeInspectionReport() {
    if (!job) return
    setOverview('Building the inspection report overview… this can take a minute.')
    const { makeOverview } = await import('../lib/inspection/browser')
    const r = await makeOverview(job, true)
    setOverview(r.ok
      ? `Done: ${r.units} units, ${r.repairs} repair items.${r.problems.length ? ' Check: ' + r.problems.join('; ') : ''}`
      : r.message)
    await loadFiles()
  }

  async function open(f: JobFile, download = false) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(f.storage_path, 300, download ? { download: f.file_name } : undefined)
    if (error) return setError(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function move(f: JobFile, category: Category) {
    const { error } = await supabase.from('job_files').update({ category }).eq('id', f.id)
    if (error) return setError(error.message)
    setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, category } : x)))
  }

  async function remove(f: JobFile) {
    if (!confirm(`Delete "${f.file_name}"? This can't be undone.`)) return
    const { error } = await supabase.storage.from(BUCKET).remove([f.storage_path])
    if (error) return setError(error.message)
    await supabase.from('job_files').delete().eq('id', f.id)
    setFiles((fs) => fs.filter((x) => x.id !== f.id))
  }

  async function deleteJob() {
    if (!job) return
    if (!confirm(`Delete job #${job.job_number} and all ${files.length} of its files? This can't be undone.`)) return
    if (files.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(files.map((f) => f.storage_path))
      if (error) return setError(error.message)
    }
    const { error } = await supabase.from('jobs').delete().eq('id', id)
    if (error) return setError(error.message)
    navigate('/')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }

  if (!job) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>

  return (
    <div className="stack">
      <Link to="/" className="muted small">← All jobs</Link>

      <div className="row between wrap gap">
        <div>
          <div className="row gap wrap">
            <h1>Job #{job.job_number}</h1>
            <StatusBadge status={job.status} />
            <InspectionBadge notes={job.notes} />
          </div>
          <div className="lead">{job.customer}</div>
        </div>
        <div className="row gap" style={{ alignItems: 'flex-start' }}>
          <ExportJob job={job} />
          <Link to={`/jobs/${id}/edit`} className="btn">Edit job</Link>
        </div>
      </div>

      {hours && (
        <section className="card hours-pin row between wrap gap">
          <div>
            <div className="label">📌 Total hours</div>
            <div className="hours-total">{hours.total} hrs</div>
            <div className="muted small">{hours.regular} regular (Mon to Fri 7 AM to 3 PM) · {hours.overtime} overtime</div>
          </div>
          {hoursFile && <button className="btn small" onClick={() => open(hoursFile)}>Open hours report</button>}
        </section>
      )}

      <CraneMasterList job={job} files={files} onMade={loadFiles} />

      <section className="card details">
        <Detail label="Site" value={job.site_address} />
        <Detail label="Contact" value={[job.contact_name, job.contact_phone, job.contact_email].filter(Boolean).join(' · ')} />
        <Detail label="Crane" value={[job.crane_make, job.capacity, job.serial_number && `S/N ${job.serial_number}`].filter(Boolean).join(' · ')} />
        <Detail label="Created" value={formatDate(job.created_at)} />
        {job.notes && <div className="notes"><div className="label">Notes</div><p>{job.notes}</p></div>}
      </section>

      <section
        className={`card dropzone ${dragging ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="stack tight">
          <h2>Add files</h2>
          <p className="muted small">Drag files here, or use the buttons. PDFs, Word, Excel, photos: anything goes.</p>
          <div className="row gap wrap">
            <label className="inline">
              Put in
              <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
                <option value="Auto">Auto (guess from name)</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{folderLabel(c)}</option>)}
              </select>
            </label>
            <button className="btn primary" onClick={() => pickRef.current?.click()}>Choose files</button>
            <button className="btn" onClick={() => cameraRef.current?.click()}>Take photo</button>
          </div>
          <input ref={pickRef} type="file" multiple hidden
            onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
          {uploads.length > 0 && (
            <ul className="uploads small">
              {uploads.map((u, i) => (
                <li key={i} className={u.status}>
                  {u.status === 'uploading' ? '⏳' : u.status === 'done' ? '✓' : '⚠'} {u.name}
                  {u.message && <span className="error"> {u.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <OutlookEmails
        jobNumber={job.job_number}
        savedNames={files.map((f) => f.file_name)}
        onSave={upload}
      />

      {error && <p className="error">{error}</p>}

      {CATEGORIES.map((cat) => {
        const inCat = files.filter((f) => f.category === cat)
        return (
          <section key={cat} className="folder">
            <h2 className="folder-title">
              {folderLabel(cat)} <span className="count">{inCat.length}</span>
            </h2>
            {cat === 'Inspection reports' && unitReports.length > 0 && (
              <div className="row gap wrap small">
                <button className="btn small" disabled={overview.startsWith('Building')} onClick={makeInspectionReport}>
                  {hasOverview ? 'Remake inspection report overview' : 'Make inspection report overview'}
                </button>
                {overview && <span className="muted">{overview}</span>}
              </div>
            )}
            {cat === 'Inspection reports' && <InspectionPackage job={job} files={files} onMade={loadFiles} />}
            {cat === 'Inspection quotes' && <InspectionQuote job={job} files={files} onMade={loadFiles} />}
            {inCat.length === 0 ? (
              <p className="muted small empty-folder">Nothing here yet.</p>
            ) : cat === 'Photos' ? (
              <div className="photo-grid">
                {inCat.map((f) => (
                  <figure key={f.id} className="photo card">
                    <button className="photo-btn" onClick={() => open(f)} title="Open full size">
                      {thumbs[f.storage_path]
                        ? <img src={thumbs[f.storage_path]} alt={f.file_name} loading="lazy" />
                        : <span className="file-icon">IMG</span>}
                    </button>
                    <figcaption className="small">
                      <span className="ellipsis">{f.file_name}</span>
                      <FileActions f={f} onOpen={open} onMove={move} onRemove={remove} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <ul className="file-list">
                {inCat.map((f) => (
                  <li key={f.id} className="file-row card">
                    <span className="file-icon">{ext(f.file_name)}</span>
                    {outlookLinks[f.id] ? (
                      <a className="file-name" href={outlookLinks[f.id]} target="_blank" rel="noopener noreferrer"
                        title="Open this email in Outlook">{f.file_name}</a>
                    ) : (
                      <button className="file-name linklike" onClick={() => open(f)}>{f.file_name}</button>
                    )}
                    {outlookLinks[f.id] && (
                      <button className="btn small ghost" onClick={() => open(f)}
                        title="Open the copy saved in Job Files">Saved copy</button>
                    )}
                    <span className="muted small hide-sm">
                      {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}
                      {f.uploaded_by && ` · ${f.uploaded_by.split('@')[0]}`}
                    </span>
                    <FileActions f={f} onOpen={open} onMove={move} onRemove={remove} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      <section className="danger-zone">
        <button className="btn danger" onClick={deleteJob}>Delete this job</button>
      </section>
    </div>
  )
}

function FileActions({ f, onOpen, onMove, onRemove }: {
  f: JobFile
  onOpen: (f: JobFile, download?: boolean) => void
  onMove: (f: JobFile, c: Category) => void
  onRemove: (f: JobFile) => void
}) {
  return (
    <span className="file-actions">
      <button className="btn small ghost" onClick={() => onOpen(f, true)}>Download</button>
      <select className="small" aria-label="Move to folder" value={f.category}
        onChange={(e) => onMove(f, e.target.value as Category)}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{folderLabel(c)}</option>)}
      </select>
      <button className="btn small ghost danger-text" onClick={() => onRemove(f)}>Delete</button>
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="detail">
      <div className="label">{label}</div>
      <div>{value || <span className="muted">—</span>}</div>
    </div>
  )
}

function ext(name: string) {
  const e = name.includes('.') ? name.split('.').pop()! : ''
  return e.slice(0, 4).toUpperCase() || 'FILE'
}

/** The Outlook web link inside a saved email page, if it has one. */
function outlookLinkFrom(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || ''
    if (/^https:\/\/(outlook\.office365\.com|outlook\.office\.com|outlook\.cloud\.microsoft)\//i.test(href)) return href
  }
  return null
}
