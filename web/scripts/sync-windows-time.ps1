# Correct clock drift using the existing Windows time source. Does not change the time zone.
$ErrorActionPreference = 'Stop'
$timeSyncStatePath = Join-Path $PSScriptRoot '..\.tooling\time-sync-status.json'
[void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $timeSyncStatePath))
try {
    $timeIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $timePrincipal = [Security.Principal.WindowsPrincipal]::new($timeIdentity)
    if (-not $timePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Windows administrator approval is required to synchronize the system clock.'
    }
    $timeService = Get-Service -Name W32Time
    if ($timeService.StartType -eq 'Disabled') { Set-Service -Name W32Time -StartupType Manual }
    if ($timeService.Status -ne 'Running') { Start-Service -Name W32Time }
    $timeMode = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Parameters' -Name Type).Type
    if ($timeMode -eq 'NoSync') {
        # Enable the existing configured peer; do not replace it or alter the time zone.
        $timeConfigurationOutput = (& w32tm.exe /config /syncfromflags:manual /update 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw $timeConfigurationOutput }
    }
    $timeSyncOutput = (& w32tm.exe /resync /rediscover 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $timeSyncOutput -match 'did not resync|no time data') { throw $timeSyncOutput }
    @{ success = $true; message = $timeSyncOutput; utc = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $timeSyncStatePath -Encoding UTF8
    Write-Output $timeSyncOutput
} catch {
    @{ success = $false; message = $_.Exception.Message } |
        ConvertTo-Json | Set-Content -LiteralPath $timeSyncStatePath -Encoding UTF8
    Write-Output ('Time synchronization did not complete: ' + $_.Exception.Message)
    exit 1
}
