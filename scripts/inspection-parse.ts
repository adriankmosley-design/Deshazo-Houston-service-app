// Dev helper: parse inspection text files and check counts.
import { readFileSync, readdirSync } from 'node:fs'
import { parseUnit, parseTicket, isTicket } from '../src/lib/inspection/parse'
const dir = process.argv[2]
for (const f of readdirSync(dir).sort()) {
  const L = readFileSync(dir + '/' + f, 'utf8').split('\n')
  if (isTicket(L)) { console.log('TICKET', JSON.stringify(parseTicket(L), null, 1)); continue }
  const u = parseUnit(L)
  if (!u) { console.log('NOT A UNIT', f); continue }
  const nrep = u.items.filter((i) => i.kind === 'repair').length
  console.log(u.id, '|', u.description, '|', u.structure, '|', u.location, '|', u.inspector, u.date, '| rep', u.counts.repair, nrep, nrep === u.counts.repair ? '' : '<<MISMATCH', '| photos', u.photoCount, '| ov', u.overview.slice(0, 60))
  console.log('   specs', JSON.stringify(u.specs))
  for (const it of u.items) console.log('   ', it.kind, it.section, '/', it.item, '/', it.status, '/', it.photos, '/', it.note.slice(0, 70))
}
