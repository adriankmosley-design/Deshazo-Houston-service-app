/**
 * Total hours report for a job, from the time entries techs log in Beloved Robot.
 * Times are the techs' local clock times. Regular time is 7 AM to 5 PM; the rest is overtime.
 */
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { BUCKET, supabase, uploadToJob, type JobFile } from './supabase'
import { hoursRows, type HoursRow, type TimeEntry } from './hoursCalc'

export type { TimeEntry, HoursRow }

export const hoursPdfName = (jobNumber: string) => `Total Hours ${jobNumber}.pdf`
const hoursPath = (jobId: string) => `${jobId}/total-hours.json`

const clock = (t: string) => {
  const h = Number(t.slice(11, 13)), m = t.slice(14, 16)
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric' })
const hrs = (n: number) => n.toFixed(2)

export function buildHoursPdf(rows: HoursRow[], job: { job_number: string; customer: string }): ArrayBuffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  doc.setFont('helvetica', 'bold').setFontSize(16).text(`Total Hours - Job ${job.job_number}`, 40, 50)
  doc.setFont('helvetica', 'normal').setFontSize(10)
    .text(job.customer || '', 40, 68)
    .text(`From Beloved Robot time entries. Regular time 7:00 AM to 5:00 PM; hours outside that are overtime. Updated ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT.`, 40, 84, { maxWidth: 530 })

  const sum = (rs: HoursRow[], k: 'total' | 'regular' | 'overtime') => rs.reduce((a, r) => a + r[k], 0)
  autoTable(doc, {
    startY: 104,
    head: [['Date', 'Tech', 'Start', 'End', 'Regular', 'Overtime', 'Total']],
    body: rows.map((r) => [day(r.date), r.tech, clock(r.start), clock(r.end), hrs(r.regular), hrs(r.overtime), hrs(r.total)]),
    foot: [['Total', '', '', '', ...[sum(rows, 'regular'), sum(rows, 'overtime'), sum(rows, 'total')].map((n) => ({ content: hrs(n), styles: { halign: 'right' as const } }))]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [28, 36, 48] },
    footStyles: { fillColor: [226, 232, 240], textColor: 20 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  })

  const techs = [...new Set(rows.map((r) => r.tech))]
  if (techs.length > 1) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
    doc.setFont('helvetica', 'bold').setFontSize(12).text('Totals by tech', 40, y)
    autoTable(doc, {
      startY: y + 8,
      head: [['Tech', 'Days', 'Regular', 'Overtime', 'Total']],
      body: techs.map((t) => {
        const rs = rows.filter((r) => r.tech === t)
        return [t, String(new Set(rs.map((r) => r.date)).size), hrs(sum(rs, 'regular')), hrs(sum(rs, 'overtime')), hrs(sum(rs, 'total'))]
      }),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [28, 36, 48] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })
  }
  return doc.output('arraybuffer')
}

/**
 * Save the job's total hours report to its Service reports folder, replacing the old one.
 * Skips the work when the time entries haven't changed since last time. Returns true when a new report was saved.
 */
export async function saveHoursReport(job: { id: string; job_number: string; customer: string }, entries: TimeEntry[]): Promise<boolean | string> {
  const rows = hoursRows(entries)
  if (!rows.length) return false
  const key = JSON.stringify(rows.map(({ tech, date, start, end }) => [tech, date, start, end]))
  const { data: files } = await supabase.from('job_files').select('*').eq('job_id', job.id).ilike('file_name', hoursPdfName(job.job_number))
  const old = (files ?? []) as JobFile[]
  if (old.length) {
    const { data } = await supabase.storage.from(BUCKET).download(hoursPath(job.id))
    if (data && (await data.text()) === key) return false
    await supabase.storage.from(BUCKET).remove(old.map((f) => f.storage_path))
    await supabase.from('job_files').delete().in('id', old.map((f) => f.id))
  }
  const err = await uploadToJob(job.id, new File([buildHoursPdf(rows, job)], hoursPdfName(job.job_number), { type: 'application/pdf' }), 'Service reports')
  if (err) return err
  await supabase.storage.from(BUCKET).remove([hoursPath(job.id)])
  await supabase.storage.from(BUCKET).upload(hoursPath(job.id), new Blob([key], { type: 'application/json' }), { contentType: 'application/json' })
  return true
}
