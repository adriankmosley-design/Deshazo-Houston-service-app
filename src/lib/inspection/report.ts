/**
 * Builds the combined "Crane Inspection Report" PDF for one job, in the layout
 * Adrian set as the template for every inspection report (job 0289992):
 *   1. header table + red safety alerts
 *   2. discrepancy summary (all repair items)
 *   3. equipment master list (sorted by D-number)
 *   4. detailed repair items with photos
 *   5. monitor items, inspection overview notes, other notes
 *   6. units with no discrepancies
 *   7. daily log summary (from the inspection ticket)
 */
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { Item, Ticket, Unit } from './parse'

/** A photo ready to place: JPEG data URL plus its pixel size. */
export type Photo = { src: string; width: number; height: number }

export type UnitWithPhotos = Unit & {
  itemPhotos: Photo[][] // photos per item, same order as unit.items
  extraPhotos: Photo[]
}

const NAVY: [number, number, number] = [31, 56, 100]
const RED: [number, number, number] = [192, 0, 0]
const GREY = 110
const PAGE_W = 792
const PAGE_H = 612
const M = 36
const TOP = 118 // below the banner
const W = PAGE_W - 2 * M

const DANGER = /do not operate|don'?t operate|not to operate|tag(ged)?[- ]?out|lock(ed)?[- ]?out|unsafe|out of service|critical safety/i

const pairs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}: ${v || '—'}`)

export function safetyAlerts(units: Unit[]): { unit: Unit; text: string }[] {
  const out: { unit: Unit; text: string }[] = []
  for (const u of units) {
    const hits = [u.overview, ...u.items.map((i) => i.note)].filter((t) => t && DANGER.test(t))
    if (hits.length) out.push({ unit: u, text: [...new Set(hits)].join(' ') })
  }
  return out
}

function dateRange(units: Unit[], ticket: Ticket | null): string {
  const ds = [
    ...units.map((u) => Date.parse(u.date)),
    ...(ticket?.days ?? []).map((d) => Date.parse(d.date)),
  ].filter((n) => !Number.isNaN(n))
  if (!ds.length) return '—'
  const f = (n: number) => new Date(n).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const lo = Math.min(...ds)
  const hi = Math.max(...ds)
  return lo === hi ? f(lo) : `${f(lo)} – ${f(hi)}`
}

export function buildReport(opts: {
  units: UnitWithPhotos[]
  ticket: Ticket | null
  jobNumber: string
  customer: string
  address?: string | null
  banner: string // PNG data URL of the DESHAZO letterhead banner
}): jsPDF {
  const units = [...opts.units].sort((a, b) => (a.id < b.id ? -1 : 1))
  const { ticket, jobNumber, banner } = opts
  const customer = ticket?.customer || opts.customer || units[0]?.customer || ''
  const address = ticket?.address || opts.address || ''
  const rep = units.filter((u) => u.items.some((i) => i.kind === 'repair'))
  const totalRepairs = units.reduce((n, u) => n + u.items.filter((i) => i.kind === 'repair').length, 0)
  const alerts = safetyAlerts(units)
  const alertIds = new Set(alerts.map((a) => a.unit.id))
  const inspectors = [...new Set(units.map((u) => u.inspector).filter(Boolean))]
  const leads = [...new Set((ticket?.days ?? []).map((d) => d.lead).filter(Boolean))]
  const type = units[0]?.type ? `${units[0].type} Inspection` : 'Inspection'

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true })
  doc.setFont('helvetica', 'normal')
  let y = TOP

  const newPage = () => { doc.addPage(); y = TOP }
  const need = (h: number) => { if (y + h > PAGE_H - 50) newPage() }
  const heading = (t: string, size = 15, pageBreak = false) => {
    if (pageBreak) newPage()
    need(size + 30)
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...NAVY)
    doc.text(t, M, y)
    y += size + 6
    doc.setTextColor(0)
  }
  /** Paragraph of mixed bold/normal runs, wrapped to the page width. */
  const para = (runs: [string, boolean?, ([number, number, number] | number)?][], size = 9.5, opt: { italic?: boolean; gap?: number } = {}) => {
    const lh = size * 1.3
    let x = M
    const lines: { x: number; t: string; bold: boolean; color: [number, number, number] | number }[][] = [[]]
    for (const [text, bold, color] of runs) {
      doc.setFont('helvetica', opt.italic ? (bold ? 'bolditalic' : 'italic') : bold ? 'bold' : 'normal').setFontSize(size)
      const words = text.split(/(\s+)/)
      for (const w of words) {
        if (!w) continue
        const ww = doc.getTextWidth(w)
        if (x + ww > M + W && w.trim()) { lines.push([]); x = M; if (!w.trim()) continue }
        if (x === M && !w.trim()) continue
        lines[lines.length - 1].push({ x, t: w, bold: !!bold, color: color ?? 0 })
        x += ww
      }
    }
    need(lines.length * lh + 2)
    for (const ln of lines) {
      for (const r of ln) {
        doc.setFont('helvetica', opt.italic ? (r.bold ? 'bolditalic' : 'italic') : r.bold ? 'bold' : 'normal').setFontSize(size)
        if (typeof r.color === 'number') doc.setTextColor(r.color); else doc.setTextColor(...r.color)
        doc.text(r.t, r.x, y)
      }
      y += lh
    }
    doc.setTextColor(0)
    y += opt.gap ?? 3
  }
  const table = (head: string[], body: (string | number)[][], o: { widths?: number[]; fill?: (row: number) => [number, number, number] | null; size?: number; width?: number; headFill?: boolean } = {}) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, top: TOP, bottom: 50 },
      head: head.length ? [head] : undefined,
      body: body.map((r) => r.map((c) => String(c))),
      theme: 'grid',
      tableWidth: o.width ?? W,
      styles: { font: 'helvetica', fontSize: o.size ?? 7.5, cellPadding: 3, lineColor: 160, lineWidth: 0.4, textColor: 20, overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      columnStyles: Object.fromEntries((o.widths ?? []).map((w, i) => [i, { cellWidth: w }])),
      rowPageBreak: 'avoid',
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const f = o.fill?.(d.row.index)
        if (f) d.cell.styles.fillColor = f
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }
  const per = 5
  const gap = 8
  const cw = (W - gap * (per - 1)) / per
  const chMax = 150
  /** height of the first photo row, so a heading never sits alone at a page bottom */
  const firstRow = (photos: Photo[]) => (photos.length ? Math.max(...photos.slice(0, per).map((p) => Math.min(chMax, (cw * p.height) / p.width))) + 14 : 14)
  const photoGrid = (photos: Photo[]) => {
    for (let i = 0; i < photos.length; i += per) {
      const row = photos.slice(i, i + per)
      const hs = row.map((p) => Math.min(chMax, (cw * p.height) / p.width))
      const rh = Math.max(...hs)
      need(rh + 6)
      row.forEach((p, j) => {
        let w = cw
        let h = (cw * p.height) / p.width
        if (h > chMax) { h = chMax; w = (chMax * p.width) / p.height }
        doc.addImage(p.src, 'JPEG', M + j * (cw + gap) + (cw - w) / 2, y, w, h, undefined, 'FAST')
      })
      y += rh + 14
    }
  }

  // ---------- 1. header ----------
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY)
  doc.text('Crane Inspection Report', PAGE_W / 2, y, { align: 'center' })
  y += 18
  doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(70)
  doc.text(`${customer}  •  Job #${jobNumber}  •  ${type}`, PAGE_W / 2, y, { align: 'center' })
  y += 14
  doc.setTextColor(0)
  const header: [string, string][] = [
    ['Customer', [customer, address].filter(Boolean).join(', ')],
    ['Job #', jobNumber],
    ['PO #', ticket?.po || units[0]?.po || '—'],
    ['Branch', ticket?.branch || '015 Houston'],
    ['Service requested', ticket?.requested || '—'],
    ['Inspection dates', dateRange(units, ticket)],
    ['Lead tech / Inspectors', [leads.length ? `${leads.join(', ')} (lead)` : '', inspectors.length ? `inspectors ${inspectors.join(', ')}` : ''].filter(Boolean).join('; ') || '—'],
    ['Units inspected', String(units.length)],
    ['Units with repairs', String(rep.length)],
    ['Total repair items', String(totalRepairs)],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: M, top: TOP, bottom: 50 },
    body: header,
    theme: 'grid',
    tableWidth: 470,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, lineColor: 160, lineWidth: 0.4, textColor: 20 },
    columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold', fillColor: [232, 238, 247] } },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  for (const a of alerts) {
    const runs: [string, boolean?, ([number, number, number] | number)?][] = [[`SAFETY ALERT – ${a.unit.id} (${a.unit.description}${a.unit.location ? ', ' + a.unit.location : ''}): `, true, RED], [a.text]]
    const top = y - 10
    para(runs, 8.5, { gap: 2 })
    doc.setDrawColor(...RED).setLineWidth(1.2).rect(M - 4, top, W + 8, y - top)
    y += 6
  }

  // ---------- 2. discrepancy summary ----------
  heading('Discrepancy Summary (all repair items)', 15, true)
  const drows: (string | number)[][] = []
  const dfill: ([number, number, number] | null)[] = []
  rep.forEach((u, ui) => u.items.filter((i) => i.kind === 'repair').forEach((it) => {
    drows.push([u.id, u.description, u.location, it.item, it.section, it.note || '(no note)', it.photos])
    dfill.push(alertIds.has(u.id) ? [253, 236, 234] : ui % 2 ? [245, 245, 245] : null)
  }))
  if (drows.length) table(['D#', 'Description', 'Location', 'Item', 'Section', 'Note', 'Photos'], drows, { widths: [50, 70, 75, 95, 70, 320, 40], fill: (r) => dfill[r] })
  para([[`${totalRepairs} repair item${totalRepairs === 1 ? '' : 's'} on ${rep.length} of ${units.length} units.`]], 8, { italic: true })

  // ---------- 3. master list ----------
  heading('Equipment Master List (sorted by D-number)', 15, true)
  table(['D#', 'Description', 'Structure', 'Location', 'Manufacturer (Crane / Hoist)', 'Serial # (Crane / Hoist)', 'Capacity (Crane / Hoist)', 'Model # (Crane / Hoist)', 'Repairs'],
    units.map((u) => [u.id, u.description, u.structure, u.location, pairs(u.specs.Manufacturer).join('\n'), pairs(u.specs['Serial Number']).join('\n'), pairs(u.specs.Capacity).join('\n'), pairs(u.specs.Model).join('\n'), u.items.filter((i) => i.kind === 'repair').length]),
    { widths: [48, 70, 90, 70, 100, 105, 82, 115, 40], fill: (r) => (units[r].items.some((i) => i.kind === 'repair') ? [255, 244, 229] : r % 2 ? [245, 245, 245] : null) })
  para([['Shaded rows have repair items. Spec values are as entered by the inspector; blank fields are shown as "—".']], 8, { italic: true })

  // ---------- 4. repair items with photos ----------
  if (rep.length) heading('Detailed Repair Items with Photos', 15, true)
  rep.forEach((u, ui) => {
    if (ui > 0) newPage()
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...NAVY)
    need(60)
    doc.text(`${u.id} — ${u.structure} (${u.description})`, M, y)
    y += 15
    doc.setTextColor(0)
    para([['Location: ', true], [u.location || '—'], ['    Inspector: ', true], [u.inspector], ['    Date: ', true], [u.date], ['    Repair items: ', true], [String(u.items.filter((i) => i.kind === 'repair').length)]], 8.5, { gap: 1 })
    for (const [lab, key] of [['Manufacturer', 'Manufacturer'], ['Serial Number', 'Serial Number'], ['Capacity', 'Capacity'], ['Model #', 'Model']] as const)
      para([[lab + ': ', true], [pairs(u.specs[key]).join(' | ')]], 8.5, { gap: 0 })
    if (u.overview) para([['Inspection overview: ', true, alertIds.has(u.id) ? RED : 0], [u.overview]], 8.5)
    let n = 0
    u.items.forEach((it, idx) => {
      if (it.kind !== 'repair') return
      n++
      y += 4
      need(40 + firstRow(u.itemPhotos[idx] ?? []))
      para([[`${n}. ${it.item}`, true], [`   [${it.section}]`, false, GREY]], 10, { gap: 1 })
      para([['Note: ', true], [it.note || '(no note)']], 8.5)
      const ph = u.itemPhotos[idx] ?? []
      if (ph.length) photoGrid(ph)
      else para([['(No photo provided for this item)']], 8, { italic: true })
    })
    if (u.extraPhotos.length) {
      y += 4
      need(40 + firstRow(u.extraPhotos))
      para([['Additional inspector photos', true], ['   [Additional Details]', false, GREY]], 10, { gap: 1 })
      if (u.extraCaptions.length) para([['Captions: ', true], [u.extraCaptions.join('; ')]], 8.5)
      photoGrid(u.extraPhotos)
    }
  })

  // ---------- 5. monitor items and notes ----------
  heading('Monitor Items and Inspector Notes', 15, true)
  para([['Informational only. These were not flagged as repairs in the inspection reports.']], 8.5, { italic: true })
  const monitors: [UnitWithPhotos, Item, number][] = []
  for (const u of units) u.items.forEach((it, idx) => { if (it.kind === 'notes' && /monitor|safety/i.test(it.status)) monitors.push([u, it, idx]) })
  if (!monitors.length) para([['No monitor items.']], 8.5)
  for (const [u, it, idx] of monitors) {
    y += 3
    need(36 + firstRow(u.itemPhotos[idx] ?? []))
    para([[`${u.id} (${u.description}${u.location ? ', ' + u.location : ''}) – ${it.item}`, true], [`   [${it.section} • ${it.status}]`, false, GREY]], 10, { gap: 1 })
    para([['Note: ', true], [it.note || '(no note)']], 8.5)
    const ph = u.itemPhotos[idx] ?? []
    if (ph.length) photoGrid(ph)
  }
  const ovs = units.filter((u) => u.overview)
  if (ovs.length) {
    y += 4
    heading('Inspection overview notes', 12)
    for (const u of ovs) para([[`• ${u.id} (${u.description}): `, true], [u.overview + (u.items.some((i) => i.kind === 'repair') ? ' (unit also has repair items)' : '')]], 8.5)
  }
  const other: [Unit, Item][] = []
  for (const u of units) for (const it of u.items) if (it.kind === 'notes' && !/monitor|safety/i.test(it.status) && it.note) other.push([u, it])
  if (other.length) {
    y += 4
    heading('Field work / other notes (item rated Satisfactory)', 12)
    for (const [u, it] of other) para([[`• ${u.id} (${u.description}) – ${it.item}: `, true], [it.note]], 8.5)
  }

  // ---------- 6. units with no discrepancies ----------
  heading('Units With No Discrepancies', 15, true)
  const ok = units.filter((u) => !u.items.some((i) => i.kind === 'repair'))
  if (ok.length) {
    const half = Math.ceil(ok.length / 2)
    const rows: string[][] = []
    const lab = (u?: Unit) => (u ? `${u.id} – ${u.description} (${u.structure}${u.location ? ', ' + u.location : ''})` : '')
    for (let i = 0; i < half; i++) rows.push([lab(ok[i]), lab(ok[i + half])])
    table([], rows, { widths: [W / 2, W / 2], size: 8.5 })
  } else para([['Every unit has at least one repair item.']], 8.5)

  // ---------- 7. daily log ----------
  y += 6
  heading('Daily Log Summary', 15)
  if (ticket && ticket.days.length) {
    const total = ticket.days.reduce((n, d) => n + d.total, 0)
    table(['Date', 'Lead', 'Technicians (start–end)', 'Hours', 'Daily customer signature'],
      [...ticket.days.map((d) => [d.date, d.lead, d.techs.map((t) => `${t.name} (${t.start}–${t.end})`).join(', ') || '—', d.total || '—', d.signedBy ? `${d.signedBy}${d.signedDate ? ', ' + d.signedDate : ''}` : 'Not signed']),
        ['Total', '', '', Math.round(total * 100) / 100, '']],
      { widths: [70, 110, 330, 50, 160], fill: (r) => (r === ticket.days.length ? [232, 238, 247] : null) })
    const svc = ticket.days.filter((d) => d.service).map((d) => `${d.date.slice(0, 5)}: ${d.service}`)
    if (svc.length) para([['Service performed (from the log): ', true], [svc.join(' ')]], 8.5)
    if (ticket.closeOut.length) para([['Close-out: ', true], [ticket.closeOut.join(' ')]], 8.5)
    para([[`Customer close-out signature: ${ticket.notSigned ? 'not signed ("Work order not signed" on the ticket).' : 'signed.'}`]], 8.5)
    para([[`Note: the inspection ticket is the daily job / JSA / timesheet log, not a per-unit inspection record, and is excluded from the unit tables. It stays with the original reports in Job Files.`]], 8, { italic: true })
  } else {
    para([['The inspection ticket (daily log) was not available when this report was made.']], 8.5, { italic: true })
  }

  // ---------- letterhead and footer on every page ----------
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.addImage(banner, 'PNG', M, 18, W, (W * 280) / 2448, 'banner', 'FAST')
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(140)
    doc.text(`Job #${jobNumber} – ${customer} – Page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 22, { align: 'center' })
  }
  doc.setTextColor(0)
  return doc
}
