import type { Status } from '../lib/supabase'

export default function StatusBadge({ status }: { status: Status }) {
  const cls = status.toLowerCase().replace(/\s+/g, '-')
  return <span className={`badge ${cls}`}>{status}</span>
}
