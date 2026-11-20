import { useEffect, useRef, useState } from 'react'
import { DUPLICATE, supabase, uploadToJob } from '../lib/supabase'
import { bookmarkletHref } from '../lib/deshazoBookmarklet'

const DESHAZO = 'https://deshazo.belovedrobot.com'
const LAST = 'jf-last-deshazo-sync'
const today = () => new Date().toLocaleDateString('en-CA')

type Row = Record<string, string | null> & { job_number: string }

/** Pulls work orders and service reports from Beloved Robot (read-only) into Job Files. */
export default function DeshazoSync({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | 'running' | 'done'>('idle')
  const [counts, setCounts] = useState({ added: 0, updated: 0, pdfs: 0, errors: 0 })
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
      const [{ data: jobs }, { data: reports }] = await Promise.all([
        supabase.from('jobs').select('id, job_number, status').limit(10000),
        supabase.from('job_files').select('job_id').ilike('file_name', 'Service Report%').limit(10000),
      ])
      const withReport = new Set((reports ?? []).map((r) => r.job_id))
      return (jobs ?? []).map((j) => ({ job_number: j.job_number, status: j.status, hasReport: withReport.has(j.id) }))
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
      const file = new File([buf], `Service Report ${num}.pdf`, { type: 'application/pdf' })
      const err = await uploadToJob(job.id, file, 'Service reports')
      if (err === DUPLICATE) return
      if (err) return bump('errors')
      bump('pdfs')
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
    setCounts({ added: 0, updated: 0, pdfs: 0, errors: 0 })
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
            {state === 'running' && `Syncing… ${counts.added} new, ${counts.updated} updated, ${counts.pdfs} service reports`}
            {state === 'done' && `Done: ${counts.added} new jobs, ${counts.updated} updated, ${counts.pdfs} service reports added${counts.errors ? `, ${counts.errors} problems` : ''}.`}
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
