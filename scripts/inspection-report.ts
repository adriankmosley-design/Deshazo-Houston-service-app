// Dev check: build the combined inspection report from local PDFs.
// npx tsx scripts/inspection-report.ts out.pdf <job#> <files...>
import { readFileSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import jpeg from 'jpeg-js'
import { makeReport } from '../src/lib/inspection/assemble'

const [out, job, ...files] = process.argv.slice(2)
const banner = 'data:image/png;base64,' + readFileSync(new URL('../src/assets/inspection-banner.png', import.meta.url)).toString('base64')
const shrink = (img: { width: number; height: number; rgba: Uint8ClampedArray }, max = 900) => {
  const s = Math.min(1, max / Math.max(img.width, img.height))
  if (s === 1) return img
  const w = Math.round(img.width * s), h = Math.round(img.height * s)
  const o = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor(x / s), sy = Math.floor(y / s)
    o.set(img.rgba.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4)
  }
  return { width: w, height: h, rgba: o }
}
const r = await makeReport({
  open: async (data) => (await pdfjs.getDocument({ data, verbosity: 0, isOffscreenCanvasSupported: false }).promise) as never,
  jpeg: (img) => { const s = shrink(img); const b = jpeg.encode({ data: Buffer.from(s.rgba), width: s.width, height: s.height }, 80).data; return { src: 'data:image/jpeg;base64,' + Buffer.from(b).toString('base64'), width: s.width, height: s.height } },
  ops: pdfjs.OPS,
}, files.map((f) => ({ name: f, data: new Uint8Array(readFileSync(f)) })), { jobNumber: job, customer: '' }, banner)
writeFileSync(out, Buffer.from(r.pdf))
console.log('units', r.units, 'repairs', r.repairs, 'problems', r.problems)
