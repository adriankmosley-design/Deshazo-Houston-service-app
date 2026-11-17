import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined
export const outlookConfigured = Boolean(clientId)

const SCOPES = ['Mail.Read']
const GRAPH = 'https://graph.microsoft.com/v1.0'

let msal: PublicClientApplication | null = null
async function client() {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId: clientId!,
        authority: 'https://login.microsoftonline.com/organizations',
        redirectUri: `${window.location.origin}/redirect.html`,
      },
      cache: { cacheLocation: 'localStorage' },
    })
    await msal.initialize()
  }
  return msal
}

export async function outlookAccount(): Promise<AccountInfo | null> {
  if (!outlookConfigured) return null
  const c = await client()
  return c.getAllAccounts()[0] ?? null
}

async function token(interactive: boolean): Promise<string> {
  const c = await client()
  const account = c.getAllAccounts()[0]
  if (account) {
    try {
      return (await c.acquireTokenSilent({ scopes: SCOPES, account })).accessToken
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError) || !interactive) throw e
    }
  } else if (!interactive) {
    throw new Error('Not connected to Outlook')
  }
  return (await c.acquireTokenPopup({ scopes: SCOPES, prompt: 'select_account' })).accessToken
}

export async function connectOutlook() {
  await token(true)
  return outlookAccount()
}

export async function disconnectOutlook() {
  const c = await client()
  const account = c.getAllAccounts()[0]
  if (account) await c.clearCache({ account })
}

async function graph(path: string) {
  const res = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${await token(true)}` } })
  if (!res.ok) throw new Error(`Outlook said ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

export type Email = {
  id: string
  subject: string
  from: string
  received: string
  preview: string
  hasAttachments: boolean
  webLink: string
}

export type Attachment = { id: string; name: string; contentType: string; size: number }

/** Emails anywhere in the mailbox that mention the job number (with or without leading zeros). */
export async function findEmails(jobNumber: string): Promise<Email[]> {
  const bare = jobNumber.replace(/^0+/, '')
  const terms = [...new Set([jobNumber, bare])].map((t) => `"${t}"`).join(' OR ')
  const q = new URLSearchParams({
    $search: `"${terms.replace(/"/g, '\\"')}"`,
    $top: '50',
    $select: 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,webLink',
  })
  const data = await (await graph(`/me/messages?${q}`)).json()
  return (data.value as any[])
    .map((m) => ({
      id: m.id,
      subject: m.subject || '(no subject)',
      from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
      received: m.receivedDateTime,
      preview: m.bodyPreview ?? '',
      hasAttachments: m.hasAttachments,
      webLink: m.webLink,
    }))
    .sort((a, b) => b.received.localeCompare(a.received))
}

export async function listAttachments(messageId: string): Promise<Attachment[]> {
  const data = await (await graph(`/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`)).json()
  return (data.value as any[])
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline)
    .map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }))
}

export async function attachmentFile(messageId: string, a: Attachment): Promise<File> {
  const res = await graph(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}/$value`)
  return new File([await res.blob()], a.name, { type: a.contentType || 'application/octet-stream' })
}

/** The whole email as an .eml file, which opens in Outlook. */
export async function emailFile(e: Email): Promise<File> {
  const res = await graph(`/me/messages/${encodeURIComponent(e.id)}/$value`)
  const date = e.received.slice(0, 10)
  const name = `Email ${date} ${e.subject}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.eml'
  return new File([await res.blob()], name, { type: 'message/rfc822' })
}

function toEmail(m: any): Email {
  return {
    id: m.id,
    subject: m.subject || '(no subject)',
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    received: m.receivedDateTime,
    preview: m.bodyPreview ?? '',
    hasAttachments: m.hasAttachments,
    webLink: m.webLink,
  }
}

/** Every email with attachments received between two dates (all folders, newest first). */
export async function emailsWithAttachments(from: Date, to: Date, max = 500): Promise<Email[]> {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${from.toISOString()} and receivedDateTime lt ${to.toISOString()} and hasAttachments eq true`,
    $orderby: 'receivedDateTime desc',
    $top: '100',
    $select: 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,webLink',
  })
  const out: Email[] = []
  let next: string | null = `/me/messages?${q}`
  while (next && out.length < max) {
    const data: any = await (await graph(next)).json()
    out.push(...(data.value as any[]).map(toEmail))
    next = data['@odata.nextLink'] ? String(data['@odata.nextLink']).replace(GRAPH, '') : null
  }
  return out.slice(0, max)
}
