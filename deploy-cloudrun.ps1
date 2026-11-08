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
    [string]$Region  = 'asia-south1',          # Mumbai: the closest Google region to Sri Lanka
    [string]$Service = 'shalom',
    [int]$MinInstances = 0                      # 0 = free when idle (a few seconds' wait after a quiet spell); 1 = always ready (~US$10-15/month)
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
gcloud config set project $Project | Out-Null

Write-Host '1. Turning on Cloud Run, Cloud Build, Artifact Registry and Secret Manager...' -ForegroundColor Cyan
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

$repo = gcloud artifacts repositories list --location=$Region --format='value(name)' 2>$null | Where-Object { $_ -like '*/shalom' }
if (-not $repo) {
    gcloud artifacts repositories create shalom --repository-format=docker --location=$Region --description='Shalom Academy app'
}

Write-Host '2. Passwords and the database, kept in Secret Manager...' -ForegroundColor Cyan
function Ensure-Secret([string]$name, [string]$prompt, [bool]$hidden) {
    $exists = gcloud secrets list --filter="name~/$name$" --format='value(name)' 2>$null
    if ($exists) { Write-Host "   ${name}: already set (kept)"; return }
    if ($hidden) {
        $s = Read-Host $prompt -AsSecureString
        $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    } else { $v = Read-Host $prompt }
    $tmp = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($tmp, $v)
        gcloud secrets create $name --data-file=$tmp --replication-policy=automatic | Out-Null
    } finally { Remove-Item $tmp -Force }
    Write-Host "   ${name}: saved"
}
Ensure-Secret 'shalom-app-password' 'Office sign-in password for the app (choose a strong one)' $true
Ensure-Secret 'shalom-db-url'      'Database JDBC URL (from Neon: Connect > Java)' $false
Ensure-Secret 'shalom-db-user'     'Database user name' $false
Ensure-Secret 'shalom-db-password' 'Database password' $true

# the Cloud Run service may read those secrets
$projNum = gcloud projects describe $Project --format='value(projectNumber)'
$runSa = "$projNum-compute@developer.gserviceaccount.com"
foreach ($s in 'shalom-app-password', 'shalom-db-url', 'shalom-db-user', 'shalom-db-password') {
    gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$runSa" --role='roles/secretmanager.secretAccessor' --quiet | Out-Null
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
    --set-secrets "APP_PASSWORD=shalom-app-password:latest,DB_URL=shalom-db-url:latest,DB_USER=shalom-db-user:latest,DB_PASSWORD=shalom-db-password:latest"

$url = gcloud run services describe $Service --region $Region --format='value(status.url)'
Write-Host ''
Write-Host "Done. The app is live at: $url" -ForegroundColor Green
Write-Host 'Sign in with the office password you chose above.'
