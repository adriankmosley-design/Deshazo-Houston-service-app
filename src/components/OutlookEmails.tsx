import { useEffect, useState } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import { formatBytes, formatDate, guessCategory, type Category } from '../lib/supabase'
import {
  attachmentFile, connectOutlook, disconnectOutlook, emailFile, findEmails, listAttachments,
  outlookAccount, outlookConfigured, type Attachment, type Email,
} from '../lib/outlook'

type Props = {
  jobNumber: string
  savedNames: string[]
  onSave: (files: File[], category?: Category) => Promise<void>
}

/** Finds Outlook emails that mention this job number and saves them (and their attachments) to the job. */
export default function OutlookEmails({ jobNumber, savedNames, onSave }: Props) {
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [emails, setEmails] = useState<Email[] | null>(null)
  const [atts, setAtts] = useState<Record<string, Attachment[]>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { outlookAccount().then(setAccount).catch(() => {}) }, [])

  if (!outlookConfigured) return null

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label)
    setError('')
    try { return await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function search() {
    await run('Searching Outlook…', async () => {
      if (!account) setAccount(await connectOutlook())
      const found = await findEmails(jobNumber)
      setEmails(found)
      const lists = await Promise.all(found.filter((e) => e.hasAttachments)
        .map(async (e) => [e.id, await listAttachments(e.id)] as const))
      setAtts(Object.fromEntries(lists))
    })
  }

  async function saveEmail(e: Email, withAttachments: boolean) {
    await run('Saving…', async () => {
      const files: File[] = [await emailFile(e)]
      if (withAttachments) {
        for (const a of atts[e.id] ?? []) {
          if (!savedNames.includes(a.name)) files.push(await attachmentFile(e.id, a))
        }
      }
      const emls = files.filter((f) => f.name.endsWith('.eml'))
      const others = files.filter((f) => !f.name.endsWith('.eml'))
      if (!savedNames.includes(emls[0].name)) await onSave(emls, 'Emails')
      if (others.length) await onSave(others)
    })
  }

  async function saveAttachment(e: Email, a: Attachment) {
    await run('Saving…', async () => onSave([await attachmentFile(e.id, a)]))
  }

  return (
    <section className="card stack tight">
      <div className="row between wrap gap">
        <div>
          <h2>Outlook emails</h2>
          <p className="muted small">
            {account
              ? <>Emails in {account.username} that mention job {jobNumber}.</>
              : <>Connect your Outlook to find emails about job {jobNumber} and save them here.</>}
          </p>
        </div>
        <div className="row gap">
          <button className="btn primary" disabled={!!busy} onClick={search}>
            {busy || (account ? (emails ? 'Search again' : 'Find emails') : 'Connect Outlook')}
          </button>
          {account && (
            <button className="btn ghost small" disabled={!!busy}
              onClick={async () => { await disconnectOutlook(); setAccount(null); setEmails(null) }}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {error && <p className="error small">{error}</p>}

      {emails && emails.length === 0 && <p className="muted small">No emails mention this job number.</p>}

      {emails && emails.length > 0 && (
        <ul className="email-list">
          {emails.map((e) => {
            const list = atts[e.id] ?? []
            const pending = list.filter((a) => !savedNames.includes(a.name))
            return (
              <li key={e.id} className="email card">
                <div className="row between gap wrap">
                  <div className="email-main">
                    <a href={e.webLink} target="_blank" rel="noopener" className="email-subject">{e.subject}</a>
                    <div className="muted small">{e.from} · {formatDate(e.received)}</div>
                  </div>
                  <button className="btn small" disabled={!!busy} onClick={() => saveEmail(e, true)}>
                    {pending.length ? `Save email + ${pending.length} file${pending.length === 1 ? '' : 's'}` : 'Save email'}
                  </button>
                </div>
                <p className="muted small email-preview">{e.preview}</p>
                {list.length > 0 && (
                  <ul className="email-atts">
                    {list.map((a) => {
                      const saved = savedNames.includes(a.name)
                      return (
                        <li key={a.id} className="row gap small">
                          <span className="ellipsis grow">📎 {a.name}</span>
                          <span className="muted">{formatBytes(a.size)} → {guessCategory(new File([], a.name, { type: a.contentType }))}</span>
                          {saved
                            ? <span className="muted">✓ Saved</span>
                            : <button className="btn small ghost" disabled={!!busy} onClick={() => saveAttachment(e, a)}>Save</button>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
