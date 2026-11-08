# Last step of the move to Singapore, and keeps the app awake so nobody waits for it to start.
#
#   & "D:\Shalom Academy of Performing Arts\fee-receipts\finish-singapore.ps1"
#
# 1. makes the Singapore app public (the office pages still need the office password, teachers their PIN)
# 2. adds a free Cloud Scheduler job that opens the app's front page every 5 minutes, so Google
#    never puts it to sleep. The front page does not touch the database, so Neon can still sleep.

$ErrorActionPreference = 'Continue'
$project = 'shalom-music-school'
$region  = 'asia-southeast1'
gcloud config set project $project 2>$null | Out-Null

Write-Host '1. Making the Singapore app public...' -ForegroundColor Cyan
gcloud run services update shalom --region $region --no-invoker-iam-check --quiet
if ($LASTEXITCODE -ne 0) { Write-Host 'Stopped: making it public did not work.' -ForegroundColor Red; exit 1 }
$url = (gcloud run services describe shalom --region $region --format='value(status.url)' 2>$null | Out-String).Trim()

Write-Host ''
Write-Host '2. Keeping it awake (a visit every 5 minutes)...' -ForegroundColor Cyan
gcloud services enable cloudscheduler.googleapis.com 2>$null | Out-Null
gcloud scheduler jobs describe shalom-keep-warm --location $region 2>$null | Out-Null
$verb = if ($LASTEXITCODE -eq 0) { 'update' } else { 'create' }
gcloud scheduler jobs $verb http shalom-keep-warm --location $region `
    --schedule '*/5 * * * *' --time-zone 'Asia/Colombo' `
    --uri "$url/" --http-method GET --attempt-deadline 60s `
    --description 'Opens the app every 5 minutes so visitors never wait for it to start (does not touch the database)'
if ($LASTEXITCODE -ne 0) { Write-Host 'Stopped: the keep-awake job could not be set up.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "Done. Use this address from now on: $url" -ForegroundColor Green
