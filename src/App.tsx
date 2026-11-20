import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured, supabase } from './lib/supabase'
import Login from './pages/Login'
import JobsList from './pages/JobsList'
import JobForm from './pages/JobForm'
import JobDetail from './pages/JobDetail'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isConfigured)

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!isConfigured) return <NotConfigured />
  if (loading) return <div className="center muted">Loading…</div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden>▣</span> Job Files
        </Link>
        <div className="topbar-right">
          <span className="muted small hide-sm">{session.user.email}</span>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<JobsList />} />
          <Route path="/jobs/new" element={<JobForm />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/jobs/:id/edit" element={<JobForm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

function NotConfigured() {
  return (
    <div className="center">
      <div className="card narrow">
        <h1>Almost there</h1>
        <p>
          This app isn't connected to its database yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> as described in the README, then reload.
        </p>
      </div>
    </div>
  )
}
