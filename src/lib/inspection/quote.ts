/**
 * The automatic repair quote for a completed inspection job: one line per
 * repair item on the unit reports, priced from the standard table in
 * quotePrices.ts, laid out like Adrian's "DESHAZO Repair Quote" form.
 */
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { Unit } from './parse'
import { stripStamp } from './parse'
import { CRITICAL, FALLBACK, LABOR_RATE, PARTS_DIVISOR, RULES, type Priority } from './quotePrices'

export const QUOTE_FOLDER = 'Inspection quotes'
export const quoteName = (jobNumber: string) => `Repair Quote ${jobNumber}.pdf`

export type QuoteLine = { desc: string; section: string; note: string; priority: Priority; hrs: number; cost: number }
export type QuoteCrane = { unit: Unit; lines: QuoteLine[] }

const PRI: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const money = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const partsPrice = (cost: number) => Math.round((cost / PARTS_DIVISOR) * 100) / 100
export const lineTotal = (l: QuoteLine) => l.hrs * LABOR_RATE + partsPrice(l.cost)

/** Price one repair item from the table. */
export function priceItem(item: string, note: string, section: string): QuoteLine {
  const rule = RULES.find((r) => r.item.test(item) && (!r.note || r.note.test(note))) ?? FALLBACK
  let priority = rule.priority
  if (CRITICAL.test(note)) priority = 'critical'
  return { desc: rule.desc.replace('{item}', item.toLowerCase()), section, note, priority, hrs: rule.hrs, cost: rule.cost }
}

/** The repair lines for each crane that has repairs, in D-number order. Duplicate lines on a crane are combined. */
export function quoteCranes(units: Unit[]): QuoteCrane[] {
  return [...units].sort((a, b) => (a.id < b.id ? -1 : 1)).map((unit) => {
    const lines: QuoteLine[] = []
    for (const it of unit.items.filter((i) => i.kind === 'repair')) {
      const l = priceItem(it.item, it.note, it.section)
      if (!lines.some((x) => x.desc === l.desc)) lines.push(l)
    }
    lines.sort((a, b) => PRI[a.priority] - PRI[b.priority])
    return { unit, lines }
  }).filter((c) => c.lines.length)
}

export function quoteTotals(cranes: QuoteCrane[]) {
  const lines = cranes.flatMap((c) => c.lines)
  const hrs = lines.reduce((s, l) => s + l.hrs, 0)
  const parts = lines.reduce((s, l) => s + partsPrice(l.cost), 0)
  const labor = hrs * LABOR_RATE
  return { lines: lines.length, critical: lines.filter((l) => l.priority === 'critical').length, hrs, parts, labor, grand: parts + labor }
}

const TERMS = 'This quote is valid for 30 days from the date of issue. All work performed in accordance with ASME B30.2 / B30.17 standards. Quoted pricing is based on standard working hours; overtime rates may apply. Parts pricing subject to supplier availability at time of order and confirmed before work begins. Customer to provide access and lift equipment unless noted. Customer approval and signed work authorization required prior to commencement of repairs.'

const specs = (u: Unit, k: 'Manufacturer' | 'Serial Number' | 'Capacity' | 'Model', who: string) => {
  const v = (u.specs[k] ?? {})[who] ?? ''
  return /^(na|n\/a|none|no data|unknown|no model number available|\.|\?)?$/i.test(v.trim()) ? '' : v.trim()
}

export function buildQuote(opts: {
  units: Unit[]
  jobNumber: string
  customer: string
  address?: string | null
  branch?: string
  logoBanner: string // PNG data URL
  logoSmall: string // PNG data URL
  issued?: Date
}): { doc: jsPDF; totals: ReturnType<typeof quoteTotals> } {
  const { units, jobNumber, logoBanner, logoSmall } = opts
  const cranes = quoteCranes(units)
  const t = quoteTotals(cranes)
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  const W = 612, H = 792, M = 18, CW = W - 2 * M, TOP = 80
  type RGB = [number, number, number]
  const YEL: RGB = [255, 183, 52], INK: RGB = [0, 0, 0], RULE: RGB = [200, 200, 200], SOFT: RGB = [221, 221, 221], LIGHT: RGB = [242, 242, 242]
  const RED: RGB = [196, 22, 28], MUTE: RGB = [80, 80, 80]
  const branch = opts.branch || '015 Houston'
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const issued = opts.issued ?? new Date()
  const validUntil = new Date(issued.getTime() + 30 * 864e5)
  const first = units[0]
  const customer = opts.customer || first?.customer || ''
  const address = opts.address || ''
  const po = units.map((u) => u.po).find((p) => p && !/unavailable/i.test(p)) || 'UNAVAILABLE'
  const dates = [...new Set(units.map((u) => u.date).filter(Boolean))].slice(0, 3).join(', ')
  const inspectors = [...new Set(units.map((u) => u.inspector).filter(Boolean))].join(', ')
  const quoteNum = `RQ-${jobNumber}`

  const lv = (x: number, y: number, label: string, value: string, size = 8, maxW = 0, align: 'left' | 'right' = 'left') => {
    let v = String(value || '—')
    let s = size
    const widthAt = (sz: number) => { doc.setFontSize(sz); doc.setFont('helvetica', 'normal'); const a = doc.getTextWidth(label + ' '); doc.setFont('helvetica', 'bold'); return a + doc.getTextWidth(v) }
    if (maxW) { while (s > 6 && widthAt(s) > maxW) s -= 0.25; while (widthAt(s) > maxW && v.length > 3) v = v.slice(0, -2).trimEnd() + '…' }
    const total = widthAt(s)
    const x0 = align === 'right' ? x - total : x
    doc.setFontSize(s); doc.setTextColor(...INK)
    doc.setFont('helvetica', 'normal'); doc.text(label + ' ', x0, y)
    const lw = doc.getTextWidth(label + ' ')
    doc.setFont('helvetica', 'bold'); doc.text(v, x0 + lw, y)
  }
  const ensure = (y: number, need: number) => { if (y + need > H - 40) { doc.addPage(); return TOP } return y }

  // Banner
  doc.setFillColor(...YEL); doc.rect(0, 0, W, 70, 'F')
  doc.addImage(logoBanner, 'PNG', 12.5, 7.5, 170, 46.25)
  lv(249, 27, 'DESHAZO Branch:', branch, 11.5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(17); doc.setTextColor(...INK)
  doc.text('REPAIR QUOTE', W - M, 41, { align: 'right' })

  // Info grid
  let y = 80
  const c4 = CW / 4, gx = [M, M + c4, M + 2 * c4, M + 3 * c4, W - M]
  type Cell = [number, number, string, string, number?]
  const rows: { h: number; cells: Cell[] }[] = [
    { h: 30, cells: [[0, 2, 'Quote #' + quoteNum, '', 10], [2, 3, 'Type:', 'Repair Quote', 9], [3, 4, 'Date:', fmtDate(issued), 9]] },
    { h: 17, cells: [[0, 2, 'Customer:', customer], [2, 3, 'Inspection:', first?.type ? first.type + ' Inspection' : 'Inspection'], [3, 4, 'Valid Until:', fmtDate(validUntil)]] },
    { h: 17, cells: [[0, 1, 'Purchase Order:', po], [1, 2, 'Job #:', jobNumber], [2, 4, 'Customer Address:', address]] },
    { h: 17, cells: [[0, 2, 'Inspection Date:', dates], [2, 4, 'Inspected By:', inspectors]] },
  ]
  doc.setDrawColor(...RULE); doc.setLineWidth(0.6)
  for (const r of rows) {
    doc.line(M, y, W - M, y)
    for (const [a, b, label, value, size] of r.cells) {
      if (a > 0) doc.line(gx[a], y, gx[a], y + r.h)
      if (size === 10) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
        doc.text(label, gx[a] + 5, y + 19)
      } else lv(gx[a] + 5, y + (r.h > 20 ? 19 : 11.5), label, value, size || 7.5, gx[b] - gx[a] - 10)
    }
    y += r.h
  }
  doc.line(M, y, W - M, y)

  // Summary blocks
  doc.setFillColor(...LIGHT); doc.rect(M, y, CW, 52, 'F')
  const blocks: [string, string, RGB][] = [[String(t.critical), 'Critical Items', RED], [String(t.lines), 'Repair Items', INK], [String(cranes.length), 'Cranes', INK], [money(t.grand), 'Quote Total', INK]]
  blocks.forEach(([n, label, col], i) => {
    const cx = M + c4 * i + c4 / 2
    if (i) { doc.setDrawColor(255, 255, 255); doc.setLineWidth(2); doc.line(M + c4 * i, y, M + c4 * i, y + 52) }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(i === 3 && n.length > 10 ? 18 : 22); doc.setTextColor(...col)
    doc.text(n, cx, y + 27, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(i === 0 ? RED : INK))
    doc.text(label, cx, y + 42, { align: 'center' })
  })
  y += 70

  // One section per crane
  const CHIP: Record<Priority, [RGB, RGB]> = { critical: [[255, 205, 205], RED], high: [[255, 228, 176], [150, 92, 0]], medium: [[214, 230, 250], [26, 80, 150]], low: [[190, 240, 200], [30, 110, 50]] }
  for (const { unit: u, lines } of cranes) {
    const need = 17 + 20 + lines.length * 22 + 16
    y = need < H - 40 - TOP ? ensure(y, need) : ensure(y, 90)
    const secTotal = lines.reduce((s, l) => s + lineTotal(l), 0)
    const title = [u.id, u.description].filter(Boolean).join(' - ')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(title, M + 4, y)
    let x = M + 4 + doc.getTextWidth(title) + 4
    doc.setTextColor(46, 160, 67); doc.text(String(lines.length), x, y); x += doc.getTextWidth(String(lines.length))
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK); doc.text(lines.length === 1 ? ' Repair Item' : ' Repair Items', x + 2, y)
    doc.setFont('helvetica', 'bold'); doc.text(money(secTotal), W - M - 4, y, { align: 'right' })
    const hoist = Object.keys(u.specs.Manufacturer ?? {}).filter((k) => k !== 'Crane')
      .map((k) => `${k}: ${[specs(u, 'Manufacturer', k), specs(u, 'Capacity', k)].filter(Boolean).join(' ')}`).join('   ')
    const sn = specs(u, 'Serial Number', 'Crane')
    const sub = [u.structure, [specs(u, 'Manufacturer', 'Crane'), specs(u, 'Model', 'Crane')].filter(Boolean).join(' '), specs(u, 'Capacity', 'Crane'),
      sn ? 'S/N ' + sn : '', /^no data$/i.test(u.location) ? '' : u.location, hoist].filter(Boolean).join('   ·   ')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
    doc.text(doc.splitTextToSize(sub, CW - 8)[0] || '', M + 4, y + 11)
    autoTable(doc, {
      startY: y + 17, margin: { left: M, right: M, top: TOP, bottom: 40 }, theme: 'plain',
      head: [['Repair / Action Item', 'Priority', 'Hrs', 'Parts', 'Labor', 'Total']],
      body: lines.map((l) => [l.desc + (l.note ? `\nFound: ${l.note}` : ''), l.priority, String(l.hrs), money(partsPrice(l.cost)), money(l.hrs * LABOR_RATE), money(lineTotal(l))]),
      styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }, lineColor: [230, 230, 230], lineWidth: { bottom: 0.6 } },
      headStyles: { fontSize: 7, textColor: MUTE, fontStyle: 'normal', lineColor: RULE, lineWidth: { bottom: 0.8 } },
      columnStyles: { 0: { cellWidth: 270 }, 1: { cellWidth: 70, halign: 'center' }, 2: { halign: 'right', cellWidth: 36 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.column.index > 1 && d.section === 'head') d.cell.styles.halign = 'right'
        if (d.column.index === 1 && d.section === 'head') d.cell.styles.halign = 'center'
        if (d.section === 'body' && d.column.index === 1) d.cell.text = ['']
      },
      didDrawCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 1) return
        const [fill, txt] = CHIP[d.cell.raw as Priority] ?? CHIP.medium
        const cw = d.cell.width - 8, ch = 12, cx = d.cell.x + 4, cy = d.cell.y + (d.cell.height - ch) / 2
        doc.setFillColor(...fill); doc.rect(cx, cy, cw, ch, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...txt)
        doc.text(String(d.cell.raw).toUpperCase(), cx + cw / 2, cy + 8.5, { align: 'center' })
      },
    })
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 12
    doc.setDrawColor(...SOFT); doc.setLineWidth(2); doc.line(M, y, W - M, y)
    y += 22
  }

  // Totals
  y = ensure(y, 110)
  const bx = W - M - 230
  doc.setFontSize(8.5)
  for (const [label, val] of [['Parts', money(t.parts)], [`Labor (${+t.hrs.toFixed(1)} hrs @ $${LABOR_RATE}/hr)`, money(t.labor)]]) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK); doc.text(label, bx, y)
    doc.setFont('helvetica', 'bold'); doc.text(val, W - M - 6, y, { align: 'right' })
    doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.6); doc.line(bx, y + 5, W - M, y + 5)
    y += 17
  }
  doc.setFillColor(...YEL); doc.rect(bx - 6, y - 4, W - M - bx + 6, 28, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK)
  doc.text('TOTAL QUOTE', bx, y + 14); doc.text(money(t.grand), W - M - 6, y + 14, { align: 'right' })
  y += 46

  // Inspector notes that are not priced
  const extras = [
    ...units.filter((u) => u.overview).map((u) => `${u.id}: ${stripStamp(u.overview)}`),
    ...units.flatMap((u) => u.items.filter((i) => i.kind === 'notes' && /monitor|safety/i.test(i.status) && i.note).map((i) => `${u.id}: ${i.item}: ${i.note} (monitor)`)),
  ].sort()
  if (extras.length) {
    y = ensure(y, 40)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
    doc.text('Also noted by the inspector (not included in this quote; can be quoted on request)', M + 4, y); y += 12
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
    for (const e of extras) {
      const ls = doc.splitTextToSize('•  ' + e, CW - 12)
      y = ensure(y, ls.length * 9 + 2)
      doc.text(ls, M + 8, y); y += ls.length * 9 + 2
    }
    y += 12
  }

  // Timeframe, terms, approval
  y = ensure(y, 150)
  lv(M + 4, y, 'Recommended Repair Timeframe:', t.critical ? 'Immediately (critical items)' : 'Within 30 days', 8.5); y += 16
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
  const terms = doc.splitTextToSize(TERMS, CW - 8)
  doc.text(terms, M + 4, y); y += terms.length * 8.5 + 14
  y = ensure(y, 60)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK); doc.text('Customer Authorization', M + 4, y); y += 6
  doc.setDrawColor(...RULE); doc.setLineWidth(0.6)
  doc.rect(M, y, CW, 34)
  for (const xx of [M + c4 * 2, M + c4 * 3]) doc.line(xx, y, xx, y + 34)
  for (const [l, xx] of [['Approved By (signature / print):', M], ['Date:', M + c4 * 2], ['Purchase Order #:', M + c4 * 3]] as const) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE); doc.text(l, xx + 5, y + 10)
  }

  // Continuation headers + page numbers
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1) {
      doc.addImage(logoSmall, 'PNG', M, 16, 157, 38)
      lv(407, 30, 'Quote #:', quoteNum, 8.5, 0, 'right')
      lv(W - M, 30, 'Job #:', jobNumber, 8.5, 0, 'right')
      lv(407, 47, 'Service Location:', branch, 8.5, 0, 'right')
      lv(W - M, 47, 'Customer Name:', customer, 8.5, 170, 'right')
      doc.setDrawColor(...YEL); doc.setLineWidth(1.8); doc.line(M, 64, W - M, 64)
    }
    doc.setFontSize(7.5); doc.setTextColor(...INK); doc.setFont('helvetica', 'normal')
    doc.text(`Page ${p}/${pages}`, W - M, H - 18, { align: 'right' })
  }
  return { doc, totals: t }
}
