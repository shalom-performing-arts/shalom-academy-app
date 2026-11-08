# Sets up the app's database on this computer's PostgreSQL 18. Run once, as administrator:
#   right-click PowerShell > Run as administrator, then:
#   & "D:\Shalom Academy of Performing Arts\fee-receipts\backend\setup-database.ps1"
#
# It starts the PostgreSQL service (and keeps it starting with Windows), then creates the
# "shalom" user and database. psql asks for the password of the "postgres" user, the one chosen
# when PostgreSQL was installed (asked once). The app's own password is read from data\database.properties.

$ErrorActionPreference = 'Stop'
$psql = 'D:\Program Files\PostgreSQL\18\bin\psql.exe'
$props = Join-Path $PSScriptRoot 'data\database.properties'

Write-Host '1. Starting the PostgreSQL service...' -ForegroundColor Cyan
Set-Service -Name 'postgresql-x64-18' -StartupType Automatic
Start-Service -Name 'postgresql-x64-18'
(Get-Service 'postgresql-x64-18').Status

$pass = (Get-Content $props | Where-Object { $_ -match '^DB_PASSWORD=' }) -replace '^DB_PASSWORD=', ''
if (-not $pass) { throw "No password found in $props" }

Write-Host '2. Creating the shalom user and database ...' -ForegroundColor Cyan
$env:PGCLIENTENCODING = 'UTF8'
$secure = Read-Host 'Password of the "postgres" user' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$exists = & $psql -U postgres -h localhost -At -c "select 1 from pg_roles where rolname = 'shalom'"
if ($exists -ne '1') {
    & $psql -U postgres -h localhost -c "create user shalom password '$pass'"
} else {
    & $psql -U postgres -h localhost -c "alter user shalom password '$pass'"
}
$db = & $psql -U postgres -h localhost -At -c "select 1 from pg_database where datname = 'shalom'"
if ($db -ne '1') { & $psql -U postgres -h localhost -c "create database shalom owner shalom encoding 'UTF8'" }

Remove-Item Env:PGPASSWORD
Write-Host 'Done. Start the app: on its first start it creates the tables and copies in the data files.' -ForegroundColor Green
