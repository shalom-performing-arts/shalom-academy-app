# Copies the academy's data (backend\data\*.json) into the cloud database, once.
#
#   & "D:\Shalom Academy of Performing Arts\fee-receipts\import-to-cloud.ps1"
#
# It asks for the database details (from Neon: Dashboard > Connect > "Java"), starts the app on
# this computer pointed at that database, lets it create the tables and copy everything in, and
# stops. Run it before the first deploy. It never copies twice: if the database already has
# students, it leaves it alone.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$java = Join-Path $root '..\tools\jdk-21.0.13+9\bin\java.exe'
if (-not (Test-Path $java)) { $java = 'java' }

Write-Host 'Database details (from Neon: Connect > Java, or your Cloud SQL instance)' -ForegroundColor Cyan
$url  = Read-Host 'JDBC URL  (e.g. jdbc:postgresql://ep-xxx.ap-southeast-1.aws.neon.tech/shalom?sslmode=require)'
$user = Read-Host 'User name'
$sec  = Read-Host 'Password' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

Write-Host 'Building the app...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend')
try {
    $env:JAVA_HOME = Split-Path (Split-Path $java)
    .\mvnw.cmd -B -q -DskipTests package
    $jar = Get-ChildItem target\receipts-api-*.jar | Select-Object -First 1

    Write-Host 'Copying the data into the cloud database...' -ForegroundColor Cyan
    $env:DB_URL = $url; $env:DB_USER = $user; $env:DB_PASSWORD = $pass
    $env:DATA_DIR = (Join-Path $root 'backend\data')
    & $java -jar $jar.FullName --app.import-only=true --server.port=0
    if ($LASTEXITCODE -ne 0) { throw "The import stopped with an error (exit $LASTEXITCODE)." }
    Write-Host 'Done. The cloud database now holds your students, payments, receipts and the rest.' -ForegroundColor Green
} finally {
    Remove-Item Env:DB_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
