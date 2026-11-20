/**
 * Glue: unit PDFs + inspection ticket PDF in, combined report out.
 * Platform bits (pdf.js document loading and JPEG encoding) are passed in,
 * so the same code runs in the browser and in the Node check script.
 */
import { docImages, docLines, type PdfDoc, type RawImage } from './pdfText'
import { isTicket, parseTicket, parseUnit, type Ticket } from './parse'
import { buildReport, masterList, type Photo, type UnitWithPhotos } from './report'

export type Env = {
  open: (data: Uint8Array) => Promise<PdfDoc>
  jpeg: (img: RawImage) => Photo | Promise<Photo>
  ops?: { paintImageXObject: number; paintInlineImageXObject: number }
}

export type Source = { name: string; data: Uint8Array }

export async function readSources(env: Env, files: Source[], photosToo = true) {
  const units: UnitWithPhotos[] = []
  let ticket: Ticket | null = null
  const problems: string[] = []
  for (const f of files) {
    const doc = await env.open(f.data.slice())
    const L = await docLines(doc)
    if (isTicket(L)) { ticket = parseTicket(L); continue }
    const u = parseUnit(L)
    if (!u) { problems.push(`${f.name}: not an inspection report`); continue }
    if (units.some((x) => x.id === u.id)) continue
    const raw = photosToo ? await docImages(doc, env.ops) : []
    const photos: Photo[] = []
    for (const r of raw) photos.push(await env.jpeg(r))
    // photos run in item order; leftovers are the "Additional Details" pictures
    let k = 0
    const itemPhotos = u.items.map((it) => { const p = photos.slice(k, k + it.photos); k += it.photos; return p })
    const nrep = u.items.filter((i) => i.kind === 'repair').length
    if (nrep !== u.counts.repair) problems.push(`${u.id}: page 1 says ${u.counts.repair} repairs, found ${nrep}`)
    if (photosToo && photos.length < u.photoCount) problems.push(`${u.id}: ${u.photoCount} photos expected, found ${photos.length}`)
    units.push({ ...u, itemPhotos, extraPhotos: photos.slice(k) })
  }
  return { units, ticket, problems }
}

export async function makeReport(env: Env, files: Source[], job: { jobNumber: string; customer: string; address?: string | null }, banner: string) {
  const { units, ticket, problems } = await readSources(env, files)
  if (!units.length) throw new Error('No unit inspection reports found for this job.')
  const doc = buildReport({ units, ticket, banner, ...job })
  return { pdf: doc.output('arraybuffer'), master: masterList(units), units: units.length, repairs: units.reduce((n, u) => n + u.items.filter((i) => i.kind === 'repair').length, 0), problems }
}
