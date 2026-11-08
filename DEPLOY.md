# Putting the app online (Google Cloud Run)

**How it works:** the `master` branch is what is live. Every push to `master` on GitHub is built
and deployed to Cloud Run by itself (about 5–8 minutes). New work happens on `dev`, and is merged
into `master` when it is ready.

```
dev ──(work, test on this computer)──► merge ──► master ──► GitHub ──► Cloud Build ──► Cloud Run
```

- **App:** Google Cloud Run, region `asia-south1` (Mumbai), one copy, free while idle.
- **Database:** Neon PostgreSQL (free plan), Singapore.
- **Passwords:** Google Secret Manager. Never in git.
- **Data:** `backend/data` (students, payments, passwords) is never in git and never uploaded.
  It is copied into the cloud database once, by `import-to-cloud.ps1`.

---

## First time (about 30 minutes)

### 1. Google sign-in and billing
```powershell
gcloud auth login
gcloud config set project shalom-music-school
```
Check **Billing** in the Google Cloud console: the project needs a billing account linked,
even to stay inside the free tier.

### 2. The database (Neon, free)
1. Sign up at **neon.tech** (Sign in with Google works).
2. New project: region **AWS Asia Pacific (Singapore)**, database name **`shalom`**.
3. **Connect → Java**: keep the JDBC URL, user name and password to hand.

### 3. Copy the data into the cloud database (once)
```powershell
& "D:\Shalom Academy of Performing Arts\fee-receipts\import-to-cloud.ps1"
```
It asks for the Neon details, creates the tables and copies everything in, then stops.

### 4. First deploy
```powershell
& "D:\Shalom Academy of Performing Arts\fee-receipts\deploy-cloudrun.ps1"
```
It asks (once) for the office sign-in password and the Neon details, keeps them in Secret
Manager, builds the app in Google Cloud Build and deploys it. At the end it prints the address,
e.g. `https://shalom-xxxxx.a.run.app`.

> Always fast instead of free-when-idle: `deploy-cloudrun.ps1 -MinInstances 1` (~US$10–15/month).

### 5. GitHub: a private repository
1. On github.com: **New repository** → name `shalom-academy-app` → **Private** → *no* README.
2. Push both branches:
```powershell
cd "D:\Shalom Academy of Performing Arts\fee-receipts"
git remote add origin https://github.com/<your-account>/shalom-academy-app.git
git push -u origin master
git push -u origin dev
```

### 6. Deploy automatically when `master` changes
Google Cloud console → **Cloud Build → Triggers → Connect repository** → GitHub → authorise →
pick `shalom-academy-app`. Then **Create trigger**:
- Event: **Push to a branch**, branch: `^master$`
- Configuration: **Cloud Build configuration file**, location `cloudbuild.yaml`
- Service account: the default Compute Engine one, with the roles **Cloud Run Admin**,
  **Service Account User** and **Artifact Registry Writer**.

From now on, pushing to `master` deploys.

---

## Every day

```powershell
git switch dev            # work here
# ... change things, try them on http://localhost:4200 ...
git add -A
git commit -m "What changed"
git push                  # dev is backed up on GitHub, nothing goes live

# ready to go live:
git switch master
git merge dev
git push                  # Cloud Build deploys it
git switch dev
```

If a deploy goes wrong: Cloud Run → `shalom` → **Revisions** → pick the previous one →
**Manage traffic → 100%**. The site is back on the old version straight away.

## Good to know
- **First visit after a quiet spell** takes about 5–10 seconds while the app wakes up; then it is fast.
- **Database changes** go in new files `backend/src/main/resources/db/migration/V3__....sql`;
  they run by themselves on the next deploy. Never edit V1 or V2.
- **Backups:** Neon keeps recent history; for a full copy, run `pg_dump` with the Neon URL.
- **Teachers' GPS check-in and copying receipt pictures** need https, which Cloud Run gives.
- **The registration link** in the Registration pool now shows the live address — share that one.
