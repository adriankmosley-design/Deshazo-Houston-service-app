import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { STATUSES, formatDate, supabase, type Job } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import BulkUpload from '../components/BulkUpload'
import OutlookImport from '../components/OutlookImport'

type Row = Job & { job_files: { count: number }[] }

export default function JobsList() {
  const [jobs, setJobs] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      let req = supabase
        .from('jobs')
        .select('*, job_files(count)')
        .order('updated_at', { ascending: false })
        .limit(200)
      if (status !== 'All') req = req.eq('status', status)

      const q = query.trim().replace(/[%,()]/g, ' ')
      if (q) {
        // Match job fields, plus any job holding a file whose name matches.
        const { data: fileHits } = await supabase
          .from('job_files')
          .select('job_id')
          .ilike('file_name', `%${q}%`)
          .limit(200)
        const ids = [...new Set((fileHits ?? []).map((f) => f.job_id))]
        const fields = ['job_number', 'customer', 'site_address', 'serial_number', 'contact_name']
          .map((f) => `${f}.ilike.%${q}%`)
        if (ids.length) fields.push(`id.in.(${ids.join(',')})`)
        req = req.or(fields.join(','))
      }

      const { data, error } = await req
      if (cancelled) return
      if (error) setError(error.message)
      setJobs((data as Row[]) ?? [])
      setLoading(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, status, reload])

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>Jobs</h1>
        <div className="row gap wrap">
          <Link to="/jobs/new" className="btn primary">+ New job</Link>
        </div>
      </div>

      <BulkUpload onDone={() => setReload((n) => n + 1)} />
      <OutlookImport onDone={() => setReload((n) => n + 1)} />

      <div className="row wrap gap">
        <input
          className="grow"
          type="search"
          placeholder="Search job #, customer, site, serial, or file name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Filter by status">
          {['All', ...STATUSES].map((s) => (
            <button key={s} className={`chip ${status === s ? 'on' : ''}`}
              onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <div className="card empty">
          <p>No jobs found.</p>
          {!query && status === 'All' && (
            <Link to="/jobs/new" className="btn primary">Create your first job</Link>
          )}
        </div>
      ) : (
        <ul className="job-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="job-row card">
                <div className="job-main">
                  <div className="row gap">
                    <strong className="job-number">#{j.job_number}</strong>
                    <StatusBadge status={j.status} />
                  </div>
                  <div>{j.customer}</div>
                  {j.site_address && <div className="muted small">{j.site_address}</div>}
                </div>
                <div className="job-meta muted small">
                  <div>{j.job_files[0]?.count ?? 0} files</div>
                  <div>Updated {formatDate(j.updated_at)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
