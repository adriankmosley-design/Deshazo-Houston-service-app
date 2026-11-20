// Dev helper: count the photos the app finds in an inspection PDF.
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { docImages } from '../src/lib/inspection/pdfText'

const data = new Uint8Array(readFileSync(process.argv[2]))
const doc = await pdfjs.getDocument({ data, verbosity: 0, isOffscreenCanvasSupported: false }).promise
const imgs = await docImages(doc as never, pdfjs.OPS)
console.log(imgs.length, imgs.map((i) => `${i.width}x${i.height}`).join(' '))
