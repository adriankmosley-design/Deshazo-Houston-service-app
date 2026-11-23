// Dev check: build the automatic repair quote from local unit PDFs.
// npx tsx scripts/inspection-quote.ts out.pdf <job#> <files...>
import { readFileSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readSources } from '../src/lib/inspection/assemble'
import { buildQuote, quoteCranes } from '../src/lib/inspection/quote'

const [out, job, ...files] = process.argv.slice(2)
const png = (f: string) => 'data:image/png;base64,' + readFileSync(new URL(`../src/assets/${f}`, import.meta.url)).toString('base64')
const { units, problems } = await readSources({
  open: async (data) => (await pdfjs.getDocument({ data, verbosity: 0, isOffscreenCanvasSupported: false }).promise) as never,
  jpeg: () => ({ src: '', width: 0, height: 0 }),
}, files.map((f) => ({ name: f, data: new Uint8Array(readFileSync(f)) })), false)
const { doc, totals } = buildQuote({ units, jobNumber: job, customer: '', logoBanner: png('quote-logo-banner.png'), logoSmall: png('quote-logo-small.png') })
writeFileSync(out, Buffer.from(doc.output('arraybuffer')))
for (const c of quoteCranes(units)) for (const l of c.lines) console.log(c.unit.id, l.priority, l.hrs, l.cost, l.desc, '|', l.note)
console.log(totals, problems)
