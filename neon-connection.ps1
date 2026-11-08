# Reads the Neon connection string once and splits it into what the app needs.
# Used by import-to-cloud.ps1 and deploy-cloudrun.ps1 (dot-sourced).
#
# In Neon: your project > Connect > copy the connection string. It looks like
#   postgresql://neondb_owner:npg_AbC123xyz@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

function Read-NeonConnection {
    # asked once per window: the second script reuses the first one's answer
    if ($env:SHALOM_DB_CONNECTION) { $text = $env:SHALOM_DB_CONNECTION } else { $text = $null }
    while ($true) {
        if (-not $text) {
            Write-Host ''
            Write-Host 'Paste the connection string from Neon (Connect > copy). It starts with postgresql://' -ForegroundColor Cyan
            Write-Host 'Right-click in this window to paste, then press Enter.' -ForegroundColor DarkGray
            $text = Read-Host 'Connection string'
        }
        $t = $text.Trim().Trim("'").Trim('"')
        # psql 'postgresql://...'  — people often copy the whole psql line
        $t = $t -replace '^psql\s+', '' -replace "^['""]", '' -replace "['""]$", ''
        if ($t -match '^(?:jdbc:)?postgres(?:ql)?://([^:/@\s]+):([^@\s]+)@([^/?\s]+)/([^?\s]+)') {
            $conn = @{
                User     = [Uri]::UnescapeDataString($Matches[1])
                Password = [Uri]::UnescapeDataString($Matches[2])
                Url      = "jdbc:postgresql://$($Matches[3])/$($Matches[4])?sslmode=require"
            }
            $env:SHALOM_DB_CONNECTION = $t
            Write-Host "   Database: $($Matches[3]) / $($Matches[4])   User: $($conn.User)" -ForegroundColor Green
            return $conn
        }
        Write-Host 'That is not a Neon connection string. It should look like:' -ForegroundColor Red
        Write-Host '   postgresql://neondb_owner:npg_xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' -ForegroundColor Red
        $text = $null
        $env:SHALOM_DB_CONNECTION = $null
    }
}
