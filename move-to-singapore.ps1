# Moves the live app and its database to Singapore, closer to Sri Lanka.
#
#   & "D:\Shalom Academy of Performing Arts\fee-receipts\move-to-singapore.ps1"
#
# 1. copies everything from the current database (Neon, Ohio) into the new Singapore one
# 2. points the app at the new database (Secret Manager)
# 3. deploys the app to Google's Singapore region (asia-southeast1)
# 4. asks whether to make the new address public
# The old database and the old app (us-central1) are left as they are, to remove afterwards.

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$project = 'shalom-music-school'
$region = 'asia-southeast1'
$pgbin = 'D:\Program Files\PostgreSQL\18\bin'
Set-Location $root
gcloud config set project $project 2>$null | Out-Null

function Stop-Here([string]$why) {
    Write-Host ''
    Write-Host "Stopped: $why" -ForegroundColor Red
    exit 1
}

# libpq connection settings from a JDBC URL; the direct host (not the -pooler one) for dump and restore
function Get-Pg([string]$jdbc, [string]$user, [string]$pass) {
    if ($jdbc -notmatch '^jdbc:postgresql://([^/?]+)/([^?]+)') { Stop-Here "Unexpected database address: $jdbc" }
    return @{ Host = ($Matches[1] -replace '-pooler\.', '.'); Db = $Matches[2]; User = $user; Pass = $pass }
}

# ---------- the database the app uses now ----------
Write-Host '1. Reading the current database details from Secret Manager...' -ForegroundColor Cyan
$oldUrl  = (gcloud secrets versions access latest --secret=shalom-db-url 2>$null | Out-String).Trim()
$oldUser = (gcloud secrets versions access latest --secret=shalom-db-user 2>$null | Out-String).Trim()
$oldPass = (gcloud secrets versions access latest --secret=shalom-db-password 2>$null | Out-String).Trim()
if (-not $oldUrl -or -not $oldPass) { Stop-Here 'Could not read the current database details.' }
$old = Get-Pg $oldUrl $oldUser $oldPass
Write-Host "   now: $($old.Host) / $($old.Db)"

# ---------- the new Singapore database ----------
Write-Host ''
Write-Host '2. The NEW Singapore database' -ForegroundColor Cyan
Write-Host '   In Neon, open the project "shalom-singapore" > Connect > copy the connection string.' -ForegroundColor DarkGray
$env:SHALOM_DB_CONNECTION = $null
. (Join-Path $root 'neon-connection.ps1')
$newConn = Read-NeonConnection
if ($newConn.Url -notmatch 'ap-southeast-1') {
    Write-Host '   Note: this address is not in Singapore (ap-southeast-1).' -ForegroundColor Yellow
    if ((Read-Host '   Use it anyway? (y/n)') -ne 'y') { Stop-Here 'Pick the Singapore project in Neon and run this again.' }
}
if ($newConn.Url -eq $oldUrl) { Stop-Here 'That is the database the app already uses. Paste the NEW Singapore one.' }
$new = Get-Pg $newConn.Url $newConn.User $newConn.Password

# ---------- copy ----------
Write-Host ''
Write-Host '3. Copying everything from the current database to Singapore...' -ForegroundColor Cyan
$dump = Join-Path $env:TEMP 'shalom-move.dump'
$env:PGSSLMODE = 'require'
$env:PGPASSWORD = $old.Pass
& "$pgbin\pg_dump.exe" -h $old.Host -U $old.User -d $old.Db -Fc --no-owner --no-acl -f $dump
if ($LASTEXITCODE -ne 0) { Stop-Here 'Could not read the current database.' }
$env:PGPASSWORD = $new.Pass
& "$pgbin\pg_restore.exe" -h $new.Host -U $new.User -d $new.Db --no-owner --no-acl --clean --if-exists $dump
$restoreCode = $LASTEXITCODE
$env:PGPASSWORD = $new.Pass
$check = (& "$pgbin\psql.exe" -h $new.Host -U $new.User -d $new.Db -At -c "select (select count(*) from students) || ' students, ' || (select count(*) from payments) || ' payments, ' || (select count(*) from receipts) || ' receipts'" 2>$null | Out-String).Trim()
$env:PGPASSWORD = $old.Pass
$was = (& "$pgbin\psql.exe" -h $old.Host -U $old.User -d $old.Db -At -c "select (select count(*) from students) || ' students, ' || (select count(*) from payments) || ' payments, ' || (select count(*) from receipts) || ' receipts'" 2>$null | Out-String).Trim()
Remove-Item Env:PGPASSWORD
Remove-Item $dump -Force -ErrorAction SilentlyContinue
Write-Host "   Ohio:      $was"
Write-Host "   Singapore: $check"
if (-not $check -or $check -ne $was) { Stop-Here "The copy does not match (restore exit $restoreCode). Nothing has been switched; the app still uses the Ohio database." }
Write-Host '   The copy matches.' -ForegroundColor Green

# ---------- point the app at Singapore ----------
Write-Host ''
Write-Host '4. Pointing the app at the Singapore database (Secret Manager)...' -ForegroundColor Cyan
foreach ($pair in @(@('shalom-db-url', $newConn.Url), @('shalom-db-user', $newConn.User), @('shalom-db-password', $newConn.Password))) {
    $tmp = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($tmp, $pair[1])
        gcloud secrets versions add $pair[0] --data-file=$tmp 2>$null | Out-Null
        $ok = $LASTEXITCODE -eq 0
    } finally { Remove-Item $tmp -Force }
    if (-not $ok) { Stop-Here "Could not update $($pair[0])." }
    Write-Host "   $($pair[0]): updated"
}

# ---------- deploy in Singapore ----------
Write-Host ''
Write-Host '5. Deploying the app in Singapore (about 5-8 minutes)...' -ForegroundColor Cyan
& (Join-Path $root 'deploy-cloudrun.ps1') -Region $region
if ($LASTEXITCODE -ne 0) { Stop-Here 'The deploy did not finish.' }

# ---------- public ----------
Write-Host ''
Write-Host 'The new app needs to be public for parents, teachers and the office to reach it' -ForegroundColor Cyan
Write-Host '(the office pages still need the office password, teachers their PIN).' -ForegroundColor DarkGray
if ((Read-Host 'Make the Singapore app public now? (y/n)') -eq 'y') {
    gcloud run services update shalom --region $region --no-invoker-iam-check
    if ($LASTEXITCODE -ne 0) { Stop-Here 'Making it public did not work.' }
}

$url = (gcloud run services describe shalom --region $region --format='value(status.url)' 2>$null | Out-String).Trim()
Write-Host ''
Write-Host "Done. The app now runs in Singapore: $url" -ForegroundColor Green
Write-Host 'The old Ohio database and the old app in us-central1 are still there; remove them once this one is checked.'
