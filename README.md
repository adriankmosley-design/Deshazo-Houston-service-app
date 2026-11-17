# Job Files

A simple website where every service job keeps all of its files in one place:
inspection reports, quotes, parts pricing, photos, letters and anything else.
It works on a PC and on a phone (you can snap photos straight into a job).

## What it does

- **Jobs list**: search by job number, customer, site, serial number or file name, and filter by status (Open, Quoted, In progress, Closed).
- **Job page**: job, contact and crane details, plus every file sorted into folders. Drag files in from your PC, or tap **Take photo** on your phone. Click a file to open it, download it, move it to another folder, or delete it.
- **Upload files box** on the Jobs page: drag many files in at once (or click **Choose files**). Each one goes to the job whose number is in its file name (for example `Service Report 0292239.pdf` goes to job 0292239).
- **Outlook emails** (optional): on a job page, **Connect Outlook** finds every email that mentions the job number. **Save email** keeps the email (opens in Outlook) in the Emails folder, plus its attachments in the right folders. Needs a one-time Microsoft app registration (below).
- **Import from Outlook** on the Jobs page: pick a date range (last 7 days by default) and click **Find emails**. Every email with attachments is matched to a job by the job number in its subject, attachment names or text (vendor POs like `291722-R291012` go to job 291012). Check the list, pick a job for any that didn't match, then click **Import**. Each email and its attachments are filed into that job; files already in the job are skipped. Signature logos are ignored.
- **Beloved Robot sync**: on the Jobs page, **Sync now** opens the Beloved Robot work orders list; click the **Send to Job Files** bookmark there (one-time setup under **Setup**) and new work orders, status changes and service report PDFs come in. It only reads from Beloved Robot. The box turns red each day until you've synced.
- **Sign in**: only people you add can get in. All files are private.

## One-time setup (about 20 minutes, no coding)

You need two free accounts: **Supabase** (holds the job list and the files) and **Vercel** (puts the website online).

### 1. Supabase: the database and file storage

1. Go to <https://supabase.com>, sign up, and click **New project**. Pick any name (for example `job-files`), set a database password (save it somewhere), and choose the region **East US**.
2. When the project is ready, open **SQL Editor** in the left menu, click **New query**, paste in everything from [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success".
3. Open **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up", so strangers can't make accounts.
4. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto confirm user**. Repeat for each coworker.
5. Open **Project Settings → API** (or the **Connect** button at the top). Copy the **Project URL** and the **anon public** key. You need both in the next step.

### 2. Vercel: put the website online

1. Go to <https://vercel.com> and sign up with your GitHub account.
2. Click **Add New → Project** and import the `Deshazo-Houston-service-app` repository.
3. Before clicking Deploy, open **Environment Variables** and add these two:
   - `VITE_SUPABASE_URL` = the Project URL from Supabase
   - `VITE_SUPABASE_ANON_KEY` = the anon public key from Supabase
4. Click **Deploy**. In a minute you get a web address like `your-app.vercel.app`. Open it, sign in, and create your first job.

On your phone, open that address and use your browser's **Add to Home Screen** to get an app icon.

### 3. Optional: connect Outlook

1. Go to <https://entra.microsoft.com> → **App registrations** → **New registration**. Name it `Job Files`, choose **Accounts in this organizational directory only**, and under Redirect URI pick **Single-page application (SPA)** with `https://<your site>/redirect.html`. Click **Register**.
2. Copy the **Application (client) ID**. Under **API permissions**, check that **Microsoft Graph → Mail.Read (Delegated)** is listed (add it if not).
3. In Vercel, add the environment variable `VITE_MS_CLIENT_ID` = that ID, then redeploy.

Each person then clicks **Connect Outlook** on any job and signs in with their work account. The app only reads mail; it never sends, moves or deletes anything.

### Free plan limits

Supabase's free plan holds 1 GB of files and pauses a project after a week with no use (you can resume it from the dashboard). If you outgrow that, the Pro plan is $25/month with 100 GB.

## For developers

```bash
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev                  # http://localhost:5173
npm run build
```

Stack: React + Vite + TypeScript, Supabase (Postgres, Auth, Storage). Files live in the private
`job-files` bucket at `<job id>/<random id>-<file name>`, with one row per file in `job_files`
(job, folder, name, size, type, uploader, date). Row-level security lets only signed-in users read or write.
