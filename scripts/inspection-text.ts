// Dev helper: print the layout text the app reads from an inspection PDF.
// npx tsx scripts/inspection-text.ts <file.pdf>
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { docLines } from '../src/lib/inspection/pdfText'

const data = new Uint8Array(readFileSync(process.argv[2]))
const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
console.log((await docLines(doc as never)).join('\n'))
