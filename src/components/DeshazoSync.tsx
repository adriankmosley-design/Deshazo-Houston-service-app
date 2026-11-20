import { useEffect, useRef, useState } from 'react'
import { BUCKET, supabase, uploadToJob } from '../lib/supabase'
import { bookmarkletHref } from '../lib/deshazoBookmarklet'

const DESHAZO = 'https://deshazo.belovedrobot.com'
const LAST = 'jf-last-deshazo-sync'
const today = () => new Date().toLocaleDateString('en-CA')

type Row = Record<string, string | null> & { job_number: string }

/** Pulls work orders and service reports from Beloved Robot (read-only) into Job Files. */
export default function DeshazoSync({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | 'running' | 'done'>('idle')
  const [counts, setCounts] = useState({ added: 0, updated: 0, pdfs: 0, overviews: 0, errors: 0 })
  const [help, setHelp] = useState(false)
  const [last, setLast] = useState(() => { try { return localStorage.getItem(LAST) } catch { return null } })
  const linkRef = useRef<HTMLAnchorElement>(null)
  const queue = useRef(Promise.resolve())

  // React won't render a javascript: link, so set the bookmark's address directly.
  useEffect(() => { linkRef.current?.setAttribute('href', bookmarkletHref(window.location.origin)) }, [help])

  const active = state !== 'idle'
  useEffect(() => {
    if (!active) return
    const bump = (k: keyof typeof counts) => setCounts((c) => ({ ...c, [k]: c[k] + 1 }))

    async function existing() {
      const [{ data: jobs }, { data: reports }, { data: overviews }] = await Promise.all([
        supabase.from('jobs').select('id, job_number, status').limit(10000),
        supabase.from('job_files').select('job_id').ilike('file_name', 'Service Report%').limit(10000),
        supabase.from('job_files').select('job_id').ilike('file_name', 'Inspection Report Overview%').limit(10000),
      ])
      const withReport = new Set((reports ?? []).map((r) => r.job_id))
      const withOverview = new Set((overviews ?? []).map((r) => r.job_id))
      return (jobs ?? []).map((j) => ({ job_number: j.job_number, status: j.status, hasReport: withReport.has(j.id), hasOverview: withOverview.has(j.id) }))
    }

    async function saveJob(row: Row) {
      const { data: found } = await supabase.from('jobs').select('id').eq('job_number', row.job_number).maybeSingle()
      if (found) {
        const { error } = await supabase.from('jobs').update({
          status: row.status, notes: row.notes, crane_make: row.crane_make, serial_number: row.serial_number,
        }).eq('id', found.id)
        bump(error ? 'errors' : 'updated')
      } else {
        const { error } = await supabase.from('jobs').insert(row)
        bump(error ? 'errors' : 'added')
      }
    }

    async function saveReport(num: string, buf: ArrayBuffer) {
      const { data: job } = await supabase.from('jobs').select('id').eq('job_number', num).maybeSingle()
      if (!job) return bump('errors')
      const { data: user } = await supabase.auth.getUser()
      const path = `${job.id}/${crypto.randomUUID()}-Service-Report-${num}.pdf`
      const up = await supabase.storage.from(BUCKET).upload(path, new Blob([buf], { type: 'application/pdf' }), { contentType: 'application/pdf' })
      if (up.error) return bump('errors')
      const { error } = await supabase.from('job_files').insert({
        job_id: job.id, category: 'Service reports', file_name: `Service Report ${num}.pdf`, storage_path: path,
        size_bytes: buf.byteLength, mime_type: 'application/pdf', uploaded_by: user.user?.email ?? null,
      })
      if (error) { await supabase.storage.from(BUCKET).remove([path]); return bump('errors') }
      bump('pdfs')
    }

    /** One crane's inspection report, saved as "D000017 Inspection Report 0291475.pdf". Skipped if already there. */
    async function saveUnit(num: string, code: string, buf: ArrayBuffer) {
      const { data: job } = await supabase.from('jobs').select('id').eq('job_number', num).maybeSingle()
      if (!job) return bump('errors')
      const name = `${code} Inspection Report ${num}.pdf`
      const { data: dup } = await supabase.from('job_files').select('id').eq('job_id', job.id).ilike('file_name', name).limit(1)
      if (dup?.length) return
      const err = await uploadToJob(job.id, new File([buf], name, { type: 'application/pdf' }), 'Inspection reports')
      if (err) bump('errors')
    }

    /** All the unit reports for a completed inspection job are in: build the overview. */
    async function saveOverview(num: string) {
      const { data: job } = await supabase.from('jobs').select('id, job_number, customer, site_address').eq('job_number', num).maybeSingle()
      if (!job) return bump('errors')
      const { makeOverview } = await import('../lib/inspection/browser')
      const r = await makeOverview(job)
      if (r.ok) bump('overviews')
      else if (!/already has/.test(r.message)) { console.warn('Inspection overview', num, r.message); bump('errors') }
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== DESHAZO || !e.data || typeof e.data !== 'object') return
      const d = e.data
      const run = async () => {
        if (d.kind === 'jf-ready') {
          setState('running')
          ;(e.source as Window | null)?.postMessage({ kind: 'jf-existing', jobs: await existing() }, DESHAZO)
        } else if (d.kind === 'jf-job' && d.row?.job_number) await saveJob(d.row)
        else if (d.kind === 'jf-pdf' && d.num && d.buf instanceof ArrayBuffer) await saveReport(String(d.num), d.buf)
        else if (d.kind === 'jf-unit' && d.num && /^D\d{6}$/.test(String(d.code)) && d.buf instanceof ArrayBuffer) await saveUnit(String(d.num), String(d.code), d.buf)
        else if (d.kind === 'jf-inspection' && d.num) await saveOverview(String(d.num))
        else if (d.kind === 'jf-done') {
          setState('done')
          try { localStorage.setItem(LAST, today()) } catch { /* private window */ }
          setLast(today())
          onDone()
        }
      }
      queue.current = queue.current.then(run, run)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active, onDone])

  function start() {
    setCounts({ added: 0, updated: 0, pdfs: 0, overviews: 0, errors: 0 })
    setState('waiting')
    window.open(`${DESHAZO}/work-orders/all`, '_blank')
  }

  const due = last !== today()

  return (
    <section className={`card stack tight ${due ? 'sync-due' : ''}`}>
      <div className="row between wrap gap">
        <div>
          <strong>{due ? "Sync today's jobs from Beloved Robot" : 'Beloved Robot sync'}</strong>
          <p className="muted small">
            {state === 'waiting' && 'On the Beloved Robot tab that just opened, click your "Send to Job Files" bookmark.'}
            {state === 'running' && `Syncing… ${counts.added} new, ${counts.updated} updated, ${counts.pdfs} service reports, ${counts.overviews} inspection overviews`}
            {state === 'done' && `Done: ${counts.added} new jobs, ${counts.updated} updated, ${counts.pdfs} service reports, ${counts.overviews} inspection overviews added${counts.errors ? `, ${counts.errors} problems` : ''}.`}
            {state === 'idle' && (last ? `Last synced ${last === today() ? 'today' : last}.` : 'Pulls the newest work orders and their service reports. Read-only on Beloved Robot.')}
          </p>
        </div>
        <div className="row gap">
          <button className={`btn ${due ? 'primary' : ''}`} disabled={state === 'running'} onClick={start}>
            {state === 'running' ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="btn ghost small" onClick={() => setHelp((h) => !h)}>{help ? 'Hide setup' : 'Setup'}</button>
        </div>
      </div>
      {help && (
        <div className="stack tight small">
          <p><strong>One-time setup:</strong> drag this button onto your Chrome bookmarks bar (press Ctrl+Shift+B if the bar is hidden):</p>
          <p>
            <a ref={linkRef} className="btn bookmarklet" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
              Send to Job Files
            </a>
          </p>
          <p className="muted">Each day: click <strong>Sync now</strong>. A Beloved Robot tab opens; when its work orders list shows, click the <strong>Send to Job Files</strong> bookmark. New jobs, status changes and service reports come straight in. Nothing is changed in Beloved Robot.</p>
        </div>
      )}
    </section>
  )
}
