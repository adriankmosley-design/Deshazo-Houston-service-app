import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { STATUSES, supabase, type Job } from '../lib/supabase'

type Draft = Omit<Job, 'id' | 'created_at' | 'updated_at'>

const EMPTY: Draft = {
  job_number: '',
  customer: '',
  site_address: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  crane_make: '',
  capacity: '',
  serial_number: '',
  status: 'Open',
  notes: '',
}

export default function JobForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    supabase.from('jobs').select('*').eq('id', id).single().then(({ data, error }) => {
      if (error) setError(error.message)
      if (data) {
        const { id: _i, created_at: _c, updated_at: _u, ...rest } = data as Job
        setDraft({ ...EMPTY, ...Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [k, v ?? '']),
        ) } as Draft)
      }
      setLoading(false)
    })
  }, [id])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    // Store blanks as empty values, not empty strings.
    const clean = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    ) as Draft
    const res = id
      ? await supabase.from('jobs').update(clean).eq('id', id).select('id').single()
      : await supabase.from('jobs').insert(clean).select('id').single()
    setSaving(false)
    if (res.error) {
      setError(res.error.code === '23505'
        ? `Job #${clean.job_number} already exists.`
        : res.error.message)
      return
    }
    navigate(`/jobs/${res.data.id}`)
  }

  if (loading) return <p className="muted">Loading…</p>

  const text = (key: keyof Draft, label: string, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={(draft[key] as string) ?? ''}
        onChange={(e) => set(key, e.target.value as never)} {...props} />
    </label>
  )

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row between wrap">
        <h1>{id ? `Edit job #${draft.job_number}` : 'New job'}</h1>
        <Link to={id ? `/jobs/${id}` : '/'} className="btn ghost">Cancel</Link>
      </div>

      <section className="card stack">
        <h2>Job</h2>
        <div className="grid">
          {text('job_number', 'Job number *', { required: true, autoFocus: !id })}
          <label>
            Status
            <select value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          {text('customer', 'Customer *', { required: true })}
          {text('site_address', 'Site address')}
        </div>
      </section>

      <section className="card stack">
        <h2>Contact</h2>
        <div className="grid">
          {text('contact_name', 'Name')}
          {text('contact_phone', 'Phone', { type: 'tel' })}
          {text('contact_email', 'Email', { type: 'email' })}
        </div>
      </section>

      <section className="card stack">
        <h2>Crane / equipment</h2>
        <div className="grid">
          {text('crane_make', 'Make / model')}
          {text('capacity', 'Capacity', { placeholder: 'e.g. 10 ton' })}
          {text('serial_number', 'Serial number')}
        </div>
      </section>

      <section className="card stack">
        <h2>Notes</h2>
        <textarea rows={5} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </section>

      {error && <p className="error">{error}</p>}
      <div className="row gap">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : id ? 'Save changes' : 'Create job'}
        </button>
      </div>
    </form>
  )
}
