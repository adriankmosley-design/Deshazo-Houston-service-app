/**
 * Job Files keeps text pages (saved emails, PDF text) as plain .txt files, so anyone can open
 * them on any computer with Notepad or any text app. This turns HTML pages into readable text
 * and converts any HTML files still stored in jobs.
 */
import { BUCKET, supabase, type JobFile } from './supabase'

export const isHtmlName = (name: string) => /\.html?$/i.test(name)
export const txtName = (name: string) => name.replace(/\.html?$/i, '.txt')

const BLOCK = /^(address|article|aside|blockquote|div|dl|dt|dd|fieldset|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|ul)$/

/** Readable plain text from an HTML page: headings and paragraphs on their own lines, links as "text (address)". */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = doc.title?.trim()
  doc.querySelectorAll('script, style, noscript, head').forEach((n) => n.remove())
  let out = ''
  const nl = (n = 1) => { out = out.replace(/[ \t]+$/, ''); while (!out.endsWith('\n'.repeat(n)) && out) out += '\n' }
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = pre ? node.textContent ?? '' : (node.textContent ?? '').replace(/\s+/g, ' ')
      out += out.endsWith('\n') && !pre ? t.trimStart() : t
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') { out += '\n'; return }
    if (tag === 'hr') { nl(); out += '----------------------------------------'; nl(); return }
    const block = BLOCK.test(tag)
    if (block) nl(/^(h[1-6]|p|table|ul|ol|blockquote)$/.test(tag) && out ? 2 : 1)
    if (tag === 'li') out += '- '
    if (tag === 'td' || tag === 'th') { if (el.previousElementSibling) out += '  |  ' }
    el.childNodes.forEach((c) => walk(c, pre || tag === 'pre'))
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      const text = (el.textContent ?? '').trim()
      if (/^(https?:|mailto:)/i.test(href) && href !== text && href.replace(/^mailto:/i, '') !== text) out += ` (${href})`
    }
    if (block) nl(/^(h[1-6]|p|table|ul|ol|blockquote)$/.test(tag) ? 2 : 1)
  }
  walk(doc.body ?? doc.documentElement, false)
  let text = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (title && !text.startsWith(title)) text = `${title}\n\n${text}`
  return text.replace(/\n/g, '\r\n') + '\r\n'
}

/** An HTML file as a .txt file (other files come back unchanged). */
export async function readableFile(file: File): Promise<File> {
  if (!isHtmlName(file.name) && file.type !== 'text/html') return file
  const name = isHtmlName(file.name) ? txtName(file.name) : `${file.name}.txt`
  return new File([htmlToText(await file.text())], name, { type: 'text/plain' })
}

/**
 * Convert every HTML file still stored in a job to a .txt file with the same name, then remove the HTML copy.
 * Safe to run again: a file whose .txt twin already exists only has the HTML copy removed.
 */
export async function convertStoredHtml(onEach?: (done: number, total: number) => void): Promise<{ converted: number; failed: number }> {
  const { data, error } = await supabase.from('job_files').select('*').or('file_name.ilike.%.html,file_name.ilike.%.htm').limit(5000)
  if (error) return { converted: 0, failed: 0 }
  const list = (data ?? []) as JobFile[]
  const { data: user } = await supabase.auth.getUser()
  let converted = 0, failed = 0, done = 0
  for (const f of list) {
    onEach?.(done++, list.length)
    const name = txtName(f.file_name)
    const { data: twin } = await supabase.from('job_files').select('id').eq('job_id', f.job_id).eq('file_name', name).limit(1)
    if (!twin?.length) {
      const { data: blob } = await supabase.storage.from(BUCKET).download(f.storage_path)
      if (!blob) { failed++; continue }
      const text = new Blob([htmlToText(await blob.text())], { type: 'text/plain' })
      const path = f.storage_path.replace(/\.html?$/i, '') + '.txt'
      const up = await supabase.storage.from(BUCKET).upload(path, text, { contentType: 'text/plain; charset=utf-8' })
      if (up.error) { failed++; continue }
      const row = await supabase.from('job_files').insert({
        job_id: f.job_id, category: f.category, file_name: name, storage_path: path, size_bytes: text.size,
        mime_type: 'text/plain', uploaded_by: f.uploaded_by ?? user.user?.email ?? null, created_at: f.created_at,
      })
      if (row.error) { await supabase.storage.from(BUCKET).remove([path]); failed++; continue }
    }
    await supabase.from('job_files').delete().eq('id', f.id)
    await supabase.storage.from(BUCKET).remove([f.storage_path])
    converted++
  }
  onEach?.(list.length, list.length)
  return { converted, failed }
}
