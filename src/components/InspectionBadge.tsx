/** Inspection jobs: the DeShazo job type is the first word(s) of the notes, e.g. "Inspection: ...". */
function isInspectionJob(notes: string | null | undefined) {
  const first = (notes ?? '').split('\n')[0]
  const type = first.includes(':') ? first.slice(0, first.indexOf(':')) : ''
  return /inspect/i.test(type)
}

export default function InspectionBadge({ notes }: { notes: string | null | undefined }) {
  return isInspectionJob(notes) ? <span className="badge inspection">Inspection</span> : null
}
