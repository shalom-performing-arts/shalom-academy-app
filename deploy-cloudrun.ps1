# First-time setup and deploy to Google Cloud Run (later deploys happen by themselves when the
# master branch changes, see DEPLOY.md — or run this again to deploy by hand).
#
#   & "D:\Shalom Academy of Performing Arts\fee-receipts\deploy-cloudrun.ps1"
#
# It turns on the Google services needed, keeps the passwords in Secret Manager (asking for them
# only the first time), and builds and deploys the app from this folder in Google Cloud Build.
# Nothing in backend\data is uploaded (see .gcloudignore).

param(
    [string]$Project = 'shalom-music-school',
    [string]$Region  = 'us-central1',          # Iowa: beside the Neon database (AWS us-east-2, Ohio), which the app talks to many times per action
    [string]$Service = 'shalom',
    [int]$MinInstances = 0                      # 0 = free when idle (a few seconds' wait after a quiet spell); 1 = always ready (~US$10-15/month)
)

# gcloud prints harmless notes on its error channel, which Windows PowerShell 5 would otherwise
# treat as a failure; so each command is judged by whether it actually succeeded instead.
$ErrorActionPreference = 'Continue'
function Assert-Ok([string]$what) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Stopped: $what did not work (see the message above)." -ForegroundColor Red
        exit 1
    }
}
Set-Location $PSScriptRoot
gcloud config set project $Project 2>$null | Out-Null

Write-Host '1. Turning on Cloud Run, Cloud Build, Artifact Registry and Secret Manager...' -ForegroundColor Cyan
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
Assert-Ok 'Turning on the Google services'

# the storage for built images: made once, kept afterwards
gcloud artifacts repositories describe shalom --location=$Region 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    gcloud artifacts repositories create shalom --repository-format=docker --location=$Region --description='Shalom Academy app'
    Assert-Ok 'Creating the image storage'
} else { Write-Host '   image storage: already there (kept)' }

Write-Host '2. Passwords and the database, kept in Secret Manager...' -ForegroundColor Cyan
function Test-Secret([string]$name) {
    [bool](gcloud secrets list --filter="name~/$name$" --format='value(name)' 2>$null)
}
function Save-Secret([string]$name, [string]$value) {
    if (Test-Secret $name) { Write-Host "   ${name}: already set (kept)"; return }
    $tmp = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($tmp, $value)
        gcloud secrets create $name --data-file=$tmp --replication-policy=automatic 2>$null | Out-Null
        $ok = $LASTEXITCODE -eq 0
    } finally { Remove-Item $tmp -Force }
    if (-not $ok) { Write-Host "Stopped: saving $name did not work." -ForegroundColor Red; exit 1 }
    Write-Host "   ${name}: saved"
}

# the office sign-in password: Enter keeps the one this computer already uses
if (-not (Test-Secret 'shalom-app-password')) {
    $file = Join-Path $PSScriptRoot 'backend\data\password.txt'
    $current = if (Test-Path $file) { (Get-Content $file -Raw).Trim() } else { '' }
    Write-Host ''
    Write-Host 'Office sign-in password for the live app.' -ForegroundColor Cyan
    if ($current) { Write-Host 'Press Enter to keep the password you use now, or type a new one.' -ForegroundColor DarkGray }
    $s = Read-Host 'Office password' -AsSecureString
    $typed = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    $office = if ($typed) { $typed } else { $current }
    if (-not $office) { throw 'An office password is needed.' }
    Save-Secret 'shalom-app-password' $office
} else { Write-Host '   shalom-app-password: already set (kept)' }

# the database: one Neon connection string gives all three
if (-not ((Test-Secret 'shalom-db-url') -and (Test-Secret 'shalom-db-user') -and (Test-Secret 'shalom-db-password'))) {
    . (Join-Path $PSScriptRoot 'neon-connection.ps1')
    $db = Read-NeonConnection
    Save-Secret 'shalom-db-url' $db.Url
    Save-Secret 'shalom-db-user' $db.User
    Save-Secret 'shalom-db-password' $db.Password
} else { Write-Host '   database details: already set (kept)' }

# the Cloud Run service may read those secrets
$projNum = gcloud projects describe $Project --format='value(projectNumber)' 2>$null
$runSa = "$projNum-compute@developer.gserviceaccount.com"
foreach ($s in 'shalom-app-password', 'shalom-db-url', 'shalom-db-user', 'shalom-db-password') {
    gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$runSa" --role='roles/secretmanager.secretAccessor' --quiet 2>$null | Out-Null
    Assert-Ok "Letting the app read $s"
}

Write-Host '3. Building and deploying (this takes about 5-8 minutes the first time)...' -ForegroundColor Cyan
gcloud run deploy $Service `
    --source . `
    --region $Region `
    --allow-unauthenticated `
    --max-instances 1 `
    --min-instances $MinInstances `
    --memory 1Gi --cpu 1 --cpu-boost `
    --timeout 300 `
    --quiet `
    --set-secrets "APP_PASSWORD=shalom-app-password:latest,DB_URL=shalom-db-url:latest,DB_USER=shalom-db-user:latest,DB_PASSWORD=shalom-db-password:latest"
Assert-Ok 'Building and deploying'

$url = gcloud run services describe $Service --region $Region --format='value(status.url)' 2>$null
Write-Host ''
Write-Host "Done. The app is live at: $url" -ForegroundColor Green
Write-Host 'Sign in with the office password you chose above.'
