# Allows only the phone hotspot gateway to reach this computer's Node dev server.
# Run as Administrator. Does not disable the firewall or alter the network profile.
$ErrorActionPreference = 'Stop'
$previewStatePath = Join-Path $PSScriptRoot '..\.tooling\phone-preview-status.json'
$previewStateDirectory = Split-Path -Parent $previewStatePath
[void][System.IO.Directory]::CreateDirectory($previewStateDirectory)

try {
    $previewIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $previewPrincipal = [Security.Principal.WindowsPrincipal]::new($previewIdentity)
    if (-not $previewPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator approval is required to create the firewall rule.'
    }

    $previewRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
        Where-Object { $_.NextHop -ne '0.0.0.0' } |
        Sort-Object { $_.RouteMetric + (Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $_.InterfaceIndex).InterfaceMetric } |
        Select-Object -First 1
    if (-not $previewRoute) { throw 'Connect this computer to the phone hotspot first.' }
    $previewAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $previewRoute.InterfaceIndex |
        Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' })
    if ($previewAddresses.Count -ne 1) { throw 'Cannot choose one hotspot address. Check the active network connection.' }
    $previewAddress = $previewAddresses[0]
    $previewUrl = 'http://{0}:3000/sign-in' -f $previewAddress.IPAddress
    $previewListener = Get-NetTCPConnection -State Listen -LocalPort 3000 | Select-Object -First 1
    $previewNodePath = (Get-Process -Id $previewListener.OwningProcess).Path
    if ($previewNodePath -ne 'C:\Program Files\nodejs\node.exe') {
        throw 'The expected Node.js development server is not listening on port 3000.'
    }

    $previewRuleArguments = @{
        Name = 'ProfitPlatePhonePreview'
        DisplayName = 'ProfitPlate phone preview'
        Direction = 'Inbound'
        Action = 'Allow'
        Enabled = 'True'
        Protocol = 'TCP'
        LocalPort = 3000
        LocalAddress = $previewAddress.IPAddress
        RemoteAddress = $previewRoute.NextHop
        Program = $previewNodePath
        Profile = @('Public', 'Private')
    }
    if (Get-NetFirewallRule -Name 'ProfitPlatePhonePreview' -ErrorAction SilentlyContinue) {
        $previewUpdateArguments = $previewRuleArguments.Clone()
        $previewUpdateArguments.Remove('DisplayName')
        Set-NetFirewallRule @previewUpdateArguments | Out-Null
    } else {
        New-NetFirewallRule @previewRuleArguments | Out-Null
    }
    @{ success = $true; message = 'Phone-only preview rule enabled.'; url = $previewUrl; phoneAddress = $previewRoute.NextHop } |
        ConvertTo-Json | Set-Content -LiteralPath $previewStatePath -Encoding UTF8
    Write-Output ('Phone preview enabled. Open ' + $previewUrl + ' on your phone.')
} catch {
    @{ success = $false; message = $_.Exception.Message } |
        ConvertTo-Json | Set-Content -LiteralPath $previewStatePath -Encoding UTF8
    Write-Output ('Could not enable phone preview: ' + $_.Exception.Message)
    exit 1
}
