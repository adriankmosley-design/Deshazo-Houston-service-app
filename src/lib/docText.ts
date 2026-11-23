/**
 * Pulls readable text out of an uploaded file so we can find the job number in it:
 * PDFs (first pages), Word/Excel/PowerPoint (headers first, then the body) and plain text.
 * Loaded on demand, because the PDF reader is large.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { strFromU8, unzipSync } from 'fflate'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ext = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

async function pdfText(data: ArrayBuffer, maxPages = 3): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, isOffscreenCanvasSupported: false }).promise
  const out: string[] = []
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n)
      const tc = await page.getTextContent()
      out.push(tc.items.map((i) => ('str' in i ? i.str : '')).join(' '))
    }
  } finally {
    await doc.destroy()
  }
  return out.join('\n')
}

const xmlText = (xml: string) => xml.replace(/<w:tab\/>|<\/w:p>|<\/a:p>|<\/si>|<\/c>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function officeText(data: ArrayBuffer): string {
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => /^(word\/(header|footer)\d*\.xml|word\/document\.xml|xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml|docProps\/core\.xml)$/.test(f.name),
  })
  // Header text first: that's where job numbers usually sit.
  const order = (n: string) => (/header/.test(n) ? 0 : /footer|core/.test(n) ? 1 : 2)
  return Object.keys(files).sort((a, b) => order(a) - order(b) || a.localeCompare(b, undefined, { numeric: true }))
    .map((n) => xmlText(strFromU8(files[n]))).join('\n')
}

/** Best-effort text of a file; empty when it can't be read (photos, unknown formats). */
export async function fileText(file: File): Promise<string> {
  const e = ext(file.name)
  try {
    if (e === 'pdf' || file.type === 'application/pdf') return await pdfText(await file.arrayBuffer())
    if (['docx', 'docm', 'xlsx', 'xlsm', 'pptx'].includes(e)) return officeText(await file.arrayBuffer())
    if (['txt', 'csv', 'eml', 'htm', 'html', 'xml', 'json', 'rtf'].includes(e) || file.type.startsWith('text/')) {
      return (await file.slice(0, 2_000_000).text())
    }
  } catch (err) {
    console.warn('Could not read', file.name, err)
  }
  return ''
}
