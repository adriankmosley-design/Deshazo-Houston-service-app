/**
 * Turns a PDF page into "layout" text lines (like `pdftotext -layout`), so the
 * Beloved Robot inspection PDFs can be read field by field, and pulls out the
 * photos embedded in them. Works with any pdf.js document (browser or Node).
 */

// Minimal shapes of the pdf.js objects we use, so this file has no runtime import of pdf.js.
type TextItem = { str: string; transform: number[]; width: number; hasEOL?: boolean }
export type PdfPage = {
  getTextContent(): Promise<{ items: unknown[] }>
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  objs: { get(id: string, cb?: (o: unknown) => void): unknown; has?(id: string): boolean }
  commonObjs?: { get(id: string, cb?: (o: unknown) => void): unknown }
  cleanup?(): void
}
export type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> }

const CW = 3.6 // points per text column

/** One page as text lines, columns kept roughly where they sit on the page. */
export async function pageLines(page: PdfPage): Promise<string[]> {
  const { items } = await page.getTextContent()
  const runs = (items as TextItem[])
    .filter((i) => typeof i.str === 'string' && i.str.trim().length > 0 && i.transform)
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))
  // group into rows by baseline
  runs.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: { y: number; runs: typeof runs }[] = []
  for (const r of runs) {
    const row = rows.find((w) => Math.abs(w.y - r.y) < 2.5)
    if (row) row.runs.push(r)
    else rows.push({ y: r.y, runs: [r] })
  }
  rows.sort((a, b) => b.y - a.y)
  const out: string[] = []
  let lastY: number | null = null
  for (const row of rows) {
    // a big vertical jump becomes a blank line, as in pdftotext
    if (lastY !== null && lastY - row.y > 16) out.push('')
    lastY = row.y
    row.runs.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -1e9
    for (const r of row.runs) {
      if (!r.s.trim()) continue // spacing runs would hide real column gaps
      const gap = r.x - end
      if (line && gap < 1) line += r.s
      else if (line && gap < 5) line += ' ' + r.s
      else {
        const col = Math.round(r.x / CW)
        const pad = Math.max(col - line.length, line ? 2 : 0)
        line += ' '.repeat(pad) + r.s
      }
      end = r.x + r.w
    }
    out.push(line.replace(/\s+$/, ''))
  }
  return out
}

/** Whole document as one list of lines, pages separated like pdftotext's form feed. */
export async function docLines(doc: PdfDoc): Promise<string[]> {
  const all: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    all.push(...(await pageLines(page)), '')
  }
  return all.map(normalize)
}

/** Ligatures and odd spaces that the inspection app's fonts produce. */
export function normalize(s: string): string {
  return s.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ /g, ' ')
}

export type RawImage = { width: number; height: number; rgba: Uint8ClampedArray }

// pdf.js OPS codes for drawing an image (stable across versions)
const PAINT_IMAGE = 85 // paintImageXObject
const PAINT_INLINE = 86 // paintInlineImageXObject

/**
 * Every raster image drawn on the pages, in drawing order, skipping the
 * DESHAZO logo (368x89) and the yellow page banner (2448x280).
 */
export async function docImages(doc: PdfDoc, opsCodes?: { paintImageXObject: number; paintInlineImageXObject: number }): Promise<RawImage[]> {
  const IMG = opsCodes?.paintImageXObject ?? PAINT_IMAGE
  const INLINE = opsCodes?.paintInlineImageXObject ?? PAINT_INLINE
  const out: RawImage[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const ops = await page.getOperatorList()
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      if (fn !== IMG && fn !== INLINE) continue
      const arg = ops.argsArray[i][0]
      const obj = (typeof arg === 'string' ? await getObj(page, arg) : arg) as ImgObj | null
      const img = obj ? toRgba(obj) : null
      if (!img) continue
      if ((img.width === 368 && img.height === 89) || (img.width === 2448 && img.height === 280)) continue
      out.push(img)
    }
  }
  return out
}

type ImgObj = { width: number; height: number; data?: Uint8ClampedArray | Uint8Array; kind?: number; bitmap?: ImageBitmap }

function getObj(page: PdfPage, id: string): Promise<unknown> {
  const store = id.startsWith('g_') && page.commonObjs ? page.commonObjs : page.objs
  return new Promise((resolve) => {
    try { store.get(id, resolve) } catch { resolve(null) }
  })
}

function toRgba(o: ImgObj): RawImage | null {
  const { width, height } = o
  if (o.data) {
    const n = width * height
    const d = o.data
    if (d.length === n * 4) return { width, height, rgba: new Uint8ClampedArray(d) }
    if (d.length === n * 3) {
      const rgba = new Uint8ClampedArray(n * 4)
      for (let i = 0, j = 0; i < n; i++, j += 3) { rgba[i * 4] = d[j]; rgba[i * 4 + 1] = d[j + 1]; rgba[i * 4 + 2] = d[j + 2]; rgba[i * 4 + 3] = 255 }
      return { width, height, rgba }
    }
    return null
  }
  if (o.bitmap && typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height)
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(o.bitmap, 0, 0)
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data }
  }
  return null
}
