/**
 * Reads the text of Beloved Robot inspection PDFs: one per crane ("unit"),
 * plus the job's inspection ticket (daily JSA / time log).
 * Ported from the inspection-report scripts (parse.py) Adrian already uses.
 */

export type Specs = Record<'Manufacturer' | 'Serial Number' | 'Capacity' | 'Model', Record<string, string>>

export type Item = {
  kind: 'repair' | 'notes'
  section: string
  item: string
  status: string
  note: string
  photos: number
  captions: string[]
}

export type Unit = {
  id: string
  inspector: string
  type: string
  date: string
  structure: string
  description: string
  location: string
  customer: string
  job: string
  po: string
  specs: Specs
  counts: { repair: number; satisfactory: number; safety: number; na: number }
  overview: string
  items: Item[]
  extraCaptions: string[]
  /** photo count promised by the item markers (n/m) */
  photoCount: number
}

const STATUS = /^\s*(Repair|Satisfactory|N\/A|Safety and Monitor|Monitor|Safety)\b/
const MARK = /(\d+)\s*\/\s*(\d+)/g
const ONLY_MARKS = /^(\s*\d+\s*\/\s*\d+\s*)+$/

const segs = (line: string) => [...line.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ pos: m.index ?? 0, s: m[0].trim() }))

const junk = (l: string) => {
  const s = l.trim()
  return !s || s === '.' || l.includes('Purchase Order:') && !l.includes('Location:') || l.includes('Service Location:') || /^Pag(e)?\b/.test(s) || /^Page \d+\/\d+$/.test(s)
}

/** Text under each label on a row of labels, following wrapped lines until the next labelled row. */
function colblock(L: string[], i: number, labels: string[], stopCol = Infinity): Record<string, string> {
  const starts = labels.map((lab) => L[i].indexOf(lab))
  const res: Record<string, string[]> = Object.fromEntries(labels.map((l) => [l, []]))
  for (let j = i; j < L.length && L[j].trim(); j++) {
    if (j > i && /(Structure|Purchase Order|Manufacturer|Customer Address|Description|Location):/.test(L[j])) break
    if (j > i && /^\s*\d+\s+\d+\s+\d+\s+\d+\s*$/.test(L[j])) break
    for (const { pos, s } of segs(L[j])) {
      if (pos >= stopCol - 2) continue
      let k = 0
      starts.forEach((st, idx) => { if (st >= 0 && st <= pos + 2) k = idx })
      res[labels[k]].push(s)
    }
  }
  return Object.fromEntries(labels.map((l) => [l, res[l].join(' ').replace(l, '').trim()]))
}

function specblock(L: string[], i: number): Specs {
  const labels = ['Manufacturer:', 'Serial Number:', 'Capacity:', 'Model #:']
  const starts = labels.map((l) => L[i].indexOf(l))
  const cols: Record<string, string[]> = Object.fromEntries(labels.map((l) => [l, []]))
  let blanks = 0
  for (let j = i + 1; j < L.length; j++) {
    if (!L[j].trim()) {
      blanks++
      if (blanks >= 1 && Object.values(cols).some((c) => c.length)) break
      continue
    }
    if (/^\s*\d+\s+\d+\s+\d+\s+\d+\s*$/.test(L[j])) break
    blanks = 0
    for (const { pos, s } of segs(L[j])) {
      let k = 0
      starts.forEach((st, idx) => { if (st >= 0 && st <= pos + 2) k = idx })
      const col = cols[labels[k]]
      if (/^(Crane|Hoist ?\d*|Trolley[^:]*|Hoist):/.test(s) || !col.length) col.push(s)
      else col[col.length - 1] += ' ' + s
    }
  }
  const out = {} as Specs
  for (const l of labels) {
    const d: Record<string, string> = {}
    for (const e of cols[l]) {
      const m = /^([^:]+):\s*(.*)$/.exec(e)
      if (m) d[m[1].trim()] = m[2].trim()
    }
    out[l.replace(':', '').replace(' #', '') as keyof Specs] = d
  }
  return out
}

/** Strip the "5:13 PM  By Nate Banda" stamp the app puts beside overview notes. */
export function stripStamp(s: string): string {
  return s.replace(/\s*\d{1,2}:\d{2}\s*[AP]M\s+By\s+[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*)?/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function parseUnit(L: string[]): Unit | null {
  const u: Partial<Unit> & { items: Item[]; extraCaptions: string[] } = { items: [], extraCaptions: [] }
  for (let i = 0; i < L.length; i++) {
    const l = L[i]
    let m = /(D\d{6}) performed by: (.*?)\s{2,}Type: (.*?)\s{2,}Date: (.*)$/.exec(l)
    if (m && !u.id) Object.assign(u, { id: m[1], inspector: m[2].trim(), type: m[3].trim(), date: m[4].trim() })
    if (l.trim().startsWith('Structure:') && u.structure === undefined) {
      const b = colblock(L, i, ['Structure:', 'Description:', 'Customer:'])
      Object.assign(u, { structure: b['Structure:'], description: b['Description:'], customer: b['Customer:'] })
    }
    if (l.includes('Purchase Order:') && l.includes('Location:') && u.location === undefined) {
      const labels = ['Purchase Order:', 'Job #:', 'Location:']
      // the customer address sits in the next column over; leave it out
      const structLine = L.find((x) => x.includes('Structure:') && x.includes('Customer:')) ?? ''
      const custCol = structLine.indexOf('Customer:')
      const b = colblock(L, i, labels, custCol > 0 ? custCol : Infinity)
      Object.assign(u, { po: b['Purchase Order:'], job: b['Job #:'], location: b['Location:'].replace(/\s*Customer Address:.*$/, '').trim() })
    }
    if (l.trim().startsWith('Manufacturer:') && !u.specs) u.specs = specblock(L, i)
    m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(l)
    if (m && !u.counts) u.counts = { repair: +m[1], satisfactory: +m[2], safety: +m[3], na: +m[4] }
  }
  if (!u.id) return null

  // Inspection overview (inspector's free-text note on page 1)
  const ovAt = L.findIndex((l) => l.trim() === 'Inspection Overview')
  const ov: string[] = []
  if (ovAt >= 0) {
    for (const l of L.slice(ovAt + 1)) {
      if (/^\S.* \d+\/\d+ Satisfactory/.test(l.trim())) break
      if (junk(l)) continue
      ov.push(l.trim())
    }
  }
  u.overview = stripStamp(ov.join(' '))

  // Repair items, then "Notes and photos" items, then extra photos
  let mode: 'repair' | 'notes' | 'extra' | null = null
  let sect = ''
  let cur: Item | null = null
  let inNote = false
  const nextReal = (idx: number) => {
    for (let k = idx + 1; k < L.length; k++) if (!junk(L[k])) return L[k].trim()
    return ''
  }
  for (let idx = 0; idx < L.length; idx++) {
    const l = L[idx]
    const s = l.trim()
    if (s === 'ACTION LIST - REPAIR ITEMS') { mode = 'repair'; cur = null; continue }
    if (s === 'NOTES AND PHOTOS') { mode = 'notes'; cur = null; continue }
    if (s === 'ADDITIONAL DETAILS - PICTURES') { mode = 'extra'; cur = null; continue }
    if (!mode) continue
    if (junk(l)) { if (!s) inNote = false; continue }
    if (s.startsWith('Description:')) {
      const caps = s.split(/\s{3,}/).filter((x) => x.trim().startsWith('Description:')).map((x) => x.trim().slice(12).trim())
      if (mode === 'extra') u.extraCaptions.push(...caps)
      else if (cur) cur.captions.push(...caps)
      continue
    }
    if (mode === 'extra') continue
    const sm = /^(.*?)\s+(\d+) (Repair )?items?$/.exec(s)
    if (sm && !STATUS.test(s)) { sect = sm[1].trim(); inNote = false; cur = null; continue }
    if (s.startsWith('Note:') || s.startsWith('Notes:')) {
      if (cur) { cur.note = s.replace(/^Notes?:/, '').trim(); inNote = true }
      continue
    }
    if (STATUS.test(s) || ONLY_MARKS.test(s)) {
      inNote = false
      if (!cur) continue
      const st = STATUS.exec(s)
      if (!cur.status && st) cur.status = st[1]
      for (const mk of s.matchAll(MARK)) cur.photos = Math.max(cur.photos, +mk[2])
      continue
    }
    if (inNote && cur) { cur.note += ' ' + s; continue }
    const nxt = nextReal(idx)
    if (STATUS.test(nxt) || ONLY_MARKS.test(nxt)) {
      cur = { kind: mode, section: sect, item: s, status: '', note: '', photos: 0, captions: [] }
      u.items.push(cur)
    }
  }
  for (const it of u.items) {
    it.note = it.note.replace(/\s+/g, ' ').trim()
    if (!it.status) it.status = it.kind === 'repair' ? 'Repair' : 'Note'
  }
  u.photoCount = u.items.reduce((n, it) => n + it.photos, 0)
  return {
    id: u.id, inspector: u.inspector ?? '', type: u.type ?? '', date: u.date ?? '',
    structure: u.structure ?? '', description: u.description ?? '', location: u.location ?? '',
    customer: u.customer ?? '', job: u.job ?? '', po: u.po ?? '',
    specs: u.specs ?? { Manufacturer: {}, 'Serial Number': {}, Capacity: {}, Model: {} },
    counts: u.counts ?? { repair: u.items.filter((i) => i.kind === 'repair').length, satisfactory: 0, safety: 0, na: 0 },
    overview: u.overview, items: u.items, extraCaptions: u.extraCaptions, photoCount: u.photoCount,
  }
}

// ---------- inspection ticket (daily log) ----------

export type Day = {
  date: string
  lead: string
  techs: { name: string; start: string; end: string; total: number }[]
  total: number
  signedBy: string
  signedDate: string
  service: string
}

export type Ticket = {
  customer: string
  address: string
  job: string
  po: string
  branch: string
  requested: string
  days: Day[]
  closeOut: string[]
  notSigned: boolean
}

export function isTicket(L: string[]): boolean {
  return L.some((l) => l.includes('JOB SAFETY ANALYSIS')) || L.some((l) => /TECHNICIAN\(S\)\s+START TIME/.test(l))
}

export function parseTicket(L: string[]): Ticket {
  const t: Ticket = { customer: '', address: '', job: '', po: '', branch: '', requested: '', days: [], closeOut: [], notSigned: false }
  const grab = (re: RegExp) => { for (const l of L) { const m = re.exec(l); if (m) return m[1].trim() } return '' }
  t.customer = grab(/^\s*Customer:\s*(.*?)(\s{2,}|$)/)
  t.address = grab(/^\s*Location:\s*(.*?)(\s{2,}Phone:|$)/)
  t.job = grab(/Job #:\s*(\d+)/)
  t.po = grab(/Purchase Order:\s*(.*?)(\s{2,}|$)/)
  t.branch = grab(/Service Location:\s*(.*?)(\s{2,}|$)/)
  t.notSigned = L.some((l) => l.includes('WORK ORDER NOT SIGNED'))
  const rq = L.findIndex((l) => l.trim() === 'SERVICE REQUESTED')
  if (rq >= 0) {
    const r: string[] = []
    for (const l of L.slice(rq + 1)) { if (!l.trim()) continue; if (/^\s*DATE:/.test(l) || /^[A-Z ()]+$/.test(l.trim())) break; r.push(l.trim()) }
    t.requested = r.join(' ')
  }
  let day: Day | null = null
  let inService = false
  for (let i = 0; i < L.length; i++) {
    const l = L[i]
    const s = l.trim()
    const dm = /DATE:\s*(\d{2}\/\d{2}\/\d{4}).*?LEAD:\s*(.*)$/.exec(l)
    if (dm) { day = { date: dm[1], lead: dm[2].trim(), techs: [], total: 0, signedBy: '', signedDate: '', service: '' }; t.days.push(day); inService = false; continue }
    if (!day) continue
    if (s === 'Service Performed') { inService = true; continue }
    if (/TECHNICIAN\(S\)\s+START TIME/.test(l)) { inService = false; continue }
    const tm = /^\s*(.+?)\s{2,}(\d{1,2}:\d{2}\s*[AP]M)\s{2,}(\d{1,2}:\d{2}\s*[AP]M)\s{2,}([\d.]+)\s*$/.exec(l)
    if (tm) { day.techs.push({ name: tm[1].trim(), start: tm[2], end: tm[3], total: +tm[4] }); continue }
    const tot = /^\s*TOTALS\s+([\d.]+)\s*$/.exec(l)
    if (tot) { day.total = +tot[1]; continue }
    if (/DAILY CUSTOMER SIGNATURE:/.test(l)) {
      // the printed name and date sit on the line just above the labels
      for (let k = i - 1; k >= 0 && k > i - 4; k--) {
        const p = L[k].trim()
        if (!p) continue
        const pm = /^(.*?)\s{2,}(\d{2}\/\d{2}\/\d{4})$/.exec(p)
        if (pm) { day.signedBy = pm[1].trim(); day.signedDate = pm[2] }
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(p)) day.signedDate = p
        break
      }
      continue
    }
    if (inService) {
      if (junk(l) || /^GENERAL SERVICE WORK$/.test(s)) continue
      day.service += ' ' + stripStamp(l.replace(/\s{3,}By\s+[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*)?\s*$/, '').trim())
      continue
    }
    if (/\?:\s*(YES|NO)\s*$/i.test(s) && !/EQUIPMENT, PRE-SHIFT|REVIEWED THE JSA/.test(s)) t.closeOut.push(s)
  }
  for (const d of t.days) {
    d.service = d.service.replace(/\s+/g, ' ').trim()
    if (!d.total) d.total = d.techs.reduce((n, x) => n + x.total, 0)
  }
  return t
}
