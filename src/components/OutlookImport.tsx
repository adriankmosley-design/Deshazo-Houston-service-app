import { useEffect, useState } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import { formatDate, matchJobText, supabase, uploadToJob } from '../lib/supabase'
import {
  attachmentFile, connectOutlook, emailFile, emailsWithAttachments, listAttachments,
  outlookAccount, outlookConfigured, type Attachment, type Email,
} from '../lib/outlook'

type JobRef = { id: string; job_number: string; customer: string }
type Row = { email: Email; atts: Attachment[]; jobId: string; on: boolean }

const day = (d: Date) => d.toISOString().slice(0, 10)

/** Run async work over a list a few at a time, so Outlook isn't flooded. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

/**
 * Pulls every Outlook email with attachments from a date range, matches each one to a job
 * by the job number in its subject, attachment names or text, and files the email and its
 * attachments into that job. Nothing is saved until the user reviews the list and clicks Import.
 */
export default function OutlookImport({ onDone }: { onDone: () => void }) {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 7 * 864e5)))
  const [to, setTo] = useState(() => day(new Date()))
  const [saveEmails, setSaveEmails] = useState(true)
  const [jobs, setJobs] = useState<JobRef[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<{ added: number; skipped: number; failed: string[] } | null>(null)

  useEffect(() => { outlookAccount().then(setAccount).catch(() => {}) }, [])
  if (!outlookConfigured) return null

  async function find() {
    setBusy('Connecting…'); setError(''); setSummary(null); setRows(null)
    try {
      if (!account) setAccount(await connectOutlook())
      setBusy('Loading jobs…')
      const { data, error: e } = await supabase.from('jobs').select('id, job_number, customer').limit(5000)
      if (e) throw new Error(e.message)
      const list = (data ?? []) as JobRef[]
      setJobs(list)
      setBusy('Searching Outlook…')
      const end = new Date(to); end.setDate(end.getDate() + 1)
      const emails = await emailsWithAttachments(new Date(from), end)
      const out: Row[] = []
      let done = 0
      await eachLimited(emails, 5, async (email) => {
        const atts = await listAttachments(email.id)
        done++
        setBusy(`Reading attachments… ${done} of ${emails.length}`)
        if (!atts.length) return // only inline pictures, like signature logos
        const job = matchJobText(email.subject, list)
          ?? matchJobText(atts.map((a) => a.name).join(' '), list)
          ?? matchJobText(email.preview, list)
        out.push({ email, atts, jobId: job?.id ?? '', on: Boolean(job) })
      })
      out.sort((a, b) => b.email.received.localeCompare(a.email.received))
      setRows(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r && r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  async function importSelected() {
    if (!rows) return
    const picked = rows.filter((r) => r.on && r.jobId)
    let added = 0, skipped = 0, n = 0
    const failed: string[] = []
    setError('')
    // Names already in each job, so running the import twice doesn't make copies.
    const ids = [...new Set(picked.map((r) => r.jobId))]
    const { data: existing } = await supabase.from('job_files').select('job_id, file_name').in('job_id', ids)
    const have = new Set((existing ?? []).map((f) => `${f.job_id}/${f.file_name}`))
    for (const r of picked) {
      setBusy(`Importing… ${++n} of ${picked.length}`)
      try {
        const files: { file: File; email: boolean }[] = []
        if (saveEmails) files.push({ file: await emailFile(r.email), email: true })
        for (const a of r.atts) {
          if (have.has(`${r.jobId}/${a.name}`)) { skipped++; continue }
          files.push({ file: await attachmentFile(r.email.id, a), email: false })
        }
        for (const { file, email } of files) {
          if (have.has(`${r.jobId}/${file.name}`)) { skipped++; continue }
          const err = await uploadToJob(r.jobId, file, email ? 'Emails' : undefined)
          if (err) failed.push(`${file.name}: ${err}`)
          else { added++; have.add(`${r.jobId}/${file.name}`) }
        }
      } catch (e) {
        failed.push(`${r.email.subject}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy('')
    setSummary({ added, skipped, failed })
    setRows(null)
    onDone()
  }

  const sortedJobs = [...jobs].sort((a, b) => a.job_number.localeCompare(b.job_number))
  const picked = rows?.filter((r) => r.on && r.jobId) ?? []
  const unmatched = rows?.filter((r) => !r.jobId).length ?? 0

  return (
    <section className="card stack tight">
      <div className="row between wrap gap">
        <div>
          <strong>Import from Outlook</strong>
          <p className="muted small">
            Finds emails with attachments in a date range and files each one to the job whose
            number is in it. You check the list before anything is saved.
          </p>
        </div>
      </div>
      <div className="row wrap gap">
        <label className="inline small">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline small">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="inline small">
          <input type="checkbox" checked={saveEmails} onChange={(e) => setSaveEmails(e.target.checked)} /> Save the email too
        </label>
        <button className="btn primary" disabled={!!busy} onClick={find}>
          {busy || (account ? 'Find emails' : 'Connect Outlook')}
        </button>
      </div>

      {error && <p className="error small">{error}</p>}

      {summary && (
        <div className="stack tight bulk-results" role="status">
          <div className="row between">
            <strong>
              {summary.added} file{summary.added === 1 ? '' : 's'} added to jobs
              {summary.skipped > 0 && <span className="muted"> · {summary.skipped} already there</span>}
            </strong>
            <button className="btn small ghost" onClick={() => setSummary(null)}>Close</button>
          </div>
          {summary.failed.length > 0 && (
            <ul className="uploads small">{summary.failed.map((f, i) => <li key={i} className="error">⚠ {f}</li>)}</ul>
          )}
        </div>
      )}

      {rows && rows.length === 0 && <p className="muted small">No emails with attachments in that range.</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="row between wrap gap">
            <span className="small">
              {rows.length} emails · {picked.length} ready to import
              {unmatched > 0 && <span className="muted"> · {unmatched} with no job number (pick a job to include them)</span>}
            </span>
            <div className="row gap">
              <button className="btn small ghost" onClick={() => setRows(null)} disabled={!!busy}>Cancel</button>
              <button className="btn primary" disabled={!!busy || !picked.length} onClick={importSelected}>
                {busy || `Import ${picked.length} email${picked.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
          <ul className="email-list">
            {rows.map((r, i) => (
              <li key={r.email.id} className="email card">
                <div className="row between gap wrap">
                  <label className="row gap email-main">
                    <input type="checkbox" checked={r.on && !!r.jobId} disabled={!r.jobId}
                      onChange={(e) => update(i, { on: e.target.checked })} />
                    <span className="stack tight">
                      <a href={r.email.webLink} target="_blank" rel="noopener" className="email-subject">{r.email.subject}</a>
                      <span className="muted small">{r.email.from} · {formatDate(r.email.received)}</span>
                    </span>
                  </label>
                  <select value={r.jobId} aria-label="Job for this email" style={{ width: 'auto' }}
                    onChange={(e) => update(i, { jobId: e.target.value, on: Boolean(e.target.value) })}>
                    <option value="">No job (skip)</option>
                    {sortedJobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.customer}</option>)}
                  </select>
                </div>
                <div className="muted small ellipsis">📎 {r.atts.map((a) => a.name).join(', ')}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
