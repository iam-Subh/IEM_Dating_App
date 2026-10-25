<#
  Connects this PC to the phone over wireless ADB - and keeps it connected.

  Usage:
      npm run connect                        # find the phone, connect, then keep it connected
      npm run connect -- -Once               # connect and exit (the old behaviour)
      npm run connect -- -Port 41987         # connect to a port you read off the phone
      npm run connect -- -PhoneIP 192.168.1.5  # the phone moved to another address
      npm run connect -- -Pair               # pair this PC with the phone (one time)

  What it does each time:
    1. Finds this PC's current Wi-Fi address and writes it into apps/mobile/.env
       (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL) when it has changed, so the
       app reaches the API without editing the file by hand.
    2. Finds the phone on the network (mDNS) and connects. The phone's address
       is remembered in .phone-ip, so a new address is picked up automatically.
    3. Opens the Metro tunnel (8081).
    4. Keeps watching: when the phone drops (sleep, Wi-Fi blip, wireless
       debugging toggled), it reconnects and reopens the tunnel by itself, and
       updates .env again if the PC's address changes. Ctrl+C to stop.

  TWO DIFFERENT PORTS are involved, and confusing them is the most common
  failure:

    connect port  Shown on the main "Wireless debugging" screen. Changes every
                  time wireless debugging is toggled or the phone reboots.

    pairing port  Shown ONLY inside "Pair device with pairing code", alongside a
                  6-digit code. It is a DIFFERENT number from the connect port,
                  and is only valid while that dialog stays open.

  Pairing is once per PC and survives reboots. Connecting is once per session.
#>

param(
    [string]$Port = "",
    [string]$PhoneIP = "",
    [switch]$Pair,
    [switch]$Once,
    [int]$WatchSeconds = 10
)

$script:ExplicitPhoneIp = [bool]$PhoneIP
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $RepoRoot ".phone-ip"
$MobileEnv = Join-Path $RepoRoot "apps\mobile\.env"

# The phone's last known address: remembered from the last connection, else this default.
$DefaultPhoneIP = "192.168.3.186"
if (Test-Path $StateFile) {
    $saved = (Get-Content $StateFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($saved -match "^\d+\.\d+\.\d+\.\d+$") { $DefaultPhoneIP = $saved }
}
if (-not $PhoneIP) { $PhoneIP = $DefaultPhoneIP }

# Locate adb: PATH first, then the standard SDK location.
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) { $adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe" }
if (-not (Test-Path $adb)) {
    Write-Host "adb not found. Install Android platform-tools." -ForegroundColor Red
    exit 1
}

# Every "ip:port" adb currently sees advertised for a service type. adb keeps
# stale registrations alongside live ones, so the result is a list of
# candidates to probe, not a list of facts.
function Get-MdnsEndpoints([string]$ServiceType) {
    $out = @()
    foreach ($line in (& $adb mdns services 2>$null)) {
        if ($line -match [regex]::Escape($ServiceType) -and $line -match "(\d+\.\d+\.\d+\.\d+):(\d+)") {
            $out += "$($Matches[1]):$($Matches[2])"
        }
    }
    return ($out | Select-Object -Unique)
}

function Show-PairingHelp([string]$Ip) {
    Write-Host ""
    Write-Host "This PC is not paired with the phone." -ForegroundColor Yellow
    Write-Host "Pair once - it is remembered afterwards:"
    Write-Host ""
    Write-Host "  1. On the phone: Settings > Developer options > Wireless debugging"
    Write-Host "  2. Tap 'Pair device with pairing code' and LEAVE THE DIALOG OPEN."
    Write-Host "  3. It shows ${Ip}:<PAIRING-port> and a 6-digit code."
    Write-Host "     That port is NOT the one on the main screen." -ForegroundColor Yellow
    Write-Host "  4. Run:  npm run connect -- -Pair" -ForegroundColor Cyan
    Write-Host "     (or:  adb pair ${Ip}:<PAIRING-port>  then type the 6-digit code)"
    Write-Host ""
    Write-Host "Paired before? Android forgets a computer after 7 days without connecting." -ForegroundColor DarkGray
    Write-Host "To stop that: Developer options > 'Disable adb authorization timeout' ON." -ForegroundColor DarkGray
    Write-Host ""
}

# --------------------------------------------------------------------------
# This PC's address -> apps/mobile/.env
# --------------------------------------------------------------------------

# This PC's IPv4 address on the network the phone is on: the same /24 as the
# phone first, then any real Wi-Fi/Ethernet address. Virtual adapters (WSL,
# Hyper-V, VirtualBox, VPNs) and link-local addresses are skipped.
function Get-PcIp([string]$NearIp) {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -notmatch "^(127\.|169\.254\.)" -and
        $_.InterfaceAlias -notmatch "vEthernet|WSL|Hyper-V|Loopback|VirtualBox|VMware|Bluetooth|Tailscale|ZeroTier|OpenVPN|WireGuard"
    })
    if (-not $addresses.Count) { return $null }
    $prefix = ($NearIp -split "\.")[0..2] -join "."
    $same = $addresses | Where-Object { $_.IPAddress.StartsWith("$prefix.") } | Select-Object -First 1
    if ($same) { return $same.IPAddress }
    $wifi = $addresses | Where-Object { $_.InterfaceAlias -match "Wi-?Fi|Wireless|WLAN" } | Select-Object -First 1
    if ($wifi) { return $wifi.IPAddress }
    return ($addresses | Select-Object -First 1).IPAddress
}

# Points the app's API and socket URLs at this PC's current address. Only the
# active lines with an IPv4 host are touched - commented ngrok fallbacks and
# everything else in the file stay as they are. Returns $true when it changed.
function Update-MobileEnv([string]$Ip) {
    if (-not $Ip -or -not (Test-Path $MobileEnv)) { return $false }
    $text = [IO.File]::ReadAllText($MobileEnv)
    $pattern = "(?m)^(EXPO_PUBLIC_(?:API|SOCKET)_URL=https?://)(\d+\.\d+\.\d+\.\d+)(?=[:/]|$)"
    $current = [regex]::Matches($text, $pattern) | ForEach-Object { $_.Groups[2].Value } | Select-Object -Unique
    if (-not $current -or (@($current).Count -eq 1 -and $current -eq $Ip)) { return $false }
    $updated = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $Ip })
    [IO.File]::WriteAllText($MobileEnv, $updated, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ""
    Write-Host "API address  $($current -join ', ') -> $Ip  (apps/mobile/.env)" -ForegroundColor Green
    Write-Host "Restart Metro so the app picks it up:  npx expo start --dev-client --clear" -ForegroundColor Yellow
    return $true
}

$script:PcIp = Get-PcIp $PhoneIP
if ($script:PcIp) {
    if (-not (Update-MobileEnv $script:PcIp)) {
        Write-Host "API address  $($script:PcIp) (unchanged)" -ForegroundColor DarkGray
    }
}
else {
    Write-Host "Could not find this PC's Wi-Fi address - apps/mobile/.env left as it is." -ForegroundColor Yellow
}

# --------------------------------------------------------------------------
# Pairing mode
# --------------------------------------------------------------------------
if ($Pair) {
    Write-Host ""
    Write-Host "Looking for an open pairing dialog..." -ForegroundColor DarkGray

    $pairEndpoints = Get-MdnsEndpoints "_adb-tls-pairing._tcp"
    $preferred = @($pairEndpoints | Where-Object { $_ -like "${PhoneIP}:*" })

    $target = $null
    if ($preferred.Count -gt 0) { $target = $preferred[0] }
    elseif ($pairEndpoints.Count -gt 0) { $target = $pairEndpoints[0] }

    if (-not $target) {
        Write-Host ""
        Write-Host "No pairing dialog is open on the phone." -ForegroundColor Red
        Write-Host "Open Settings > Developer options > Wireless debugging >"
        Write-Host "'Pair device with pairing code', keep it on screen, then re-run:"
        Write-Host "  npm run connect -- -Pair" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "If it is still not found, pair manually using the port shown in"
        Write-Host "that dialog:  adb pair ${PhoneIP}:<PAIRING-port>"
        exit 1
    }

    Write-Host "Pairing with $target" -ForegroundColor Cyan
    Write-Host "Enter the 6-digit code from the dialog (not the port number)."
    & $adb pair $target
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Pairing failed. The pairing port changes every time that dialog is" -ForegroundColor Red
        Write-Host "reopened, so close it, open it again, and re-run straight away."
        exit 1
    }

    Write-Host ""
    Write-Host "Paired. Now connecting..." -ForegroundColor Green
    # falls through to the connect logic below
}

# --------------------------------------------------------------------------
# Connect
# --------------------------------------------------------------------------

# One attempt: probes every candidate and returns the "ip:port" that connected,
# or $null. Why it failed is left in $script:Dead / $script:Unpaired.
function Connect-Phone([string]$OnlyPort, [bool]$Quiet) {
    $script:Dead = @()       # nothing listening: a stale mDNS registration
    $script:Unpaired = @()   # port is live, but the phone rejected this PC's key

    $candidates = @()
    if ($OnlyPort) {
        $candidates = @("${PhoneIP}:${OnlyPort}")
    }
    else {
        if (-not $Quiet) { Write-Host "Looking for the phone on the network..." -ForegroundColor DarkGray }
        $found = Get-MdnsEndpoints "_adb-tls-connect._tcp"
        # The remembered address first; any other address the phone now advertises
        # after it. An address given with -PhoneIP is the only one tried - on a
        # shared Wi-Fi the others are other people's phones.
        $candidates = @($found | Where-Object { $_ -like "${PhoneIP}:*" })
        if (-not $script:ExplicitPhoneIp) { $candidates += @($found | Where-Object { $_ -notlike "${PhoneIP}:*" }) }
    }

    foreach ($target in $candidates) {
        if (-not $Quiet) { Write-Host "Trying $target ..." -ForegroundColor DarkGray }

        # Keep adb's message. Which failure this is decides what the user has to do,
        # and discarding it is what left this script unable to say "you need to pair".
        $result = (& $adb connect $target 2>&1 | Out-String).Trim()
        Start-Sleep -Milliseconds 600

        $line = (& $adb devices) | Where-Object { $_ -match [regex]::Escape($target) } | Select-Object -First 1
        if ($line -match "device\s*$") { return $target }

        if ($line -match "unauthorized") {
            Write-Host ""
            Write-Host "UNAUTHORIZED - accept the debugging prompt on your phone, then re-run." -ForegroundColor Yellow
            exit 1
        }

        # "actively refused" / "Connection refused" means nothing is listening there.
        # Any other failure on a socket that did open means the TLS handshake was
        # rejected, which is exactly what an unpaired PC looks like.
        if ($result -match "refused|10061|No route to host|timed out|unreachable") {
            $script:Dead += $target
            if (-not $Quiet) { Write-Host "   no listener - stale port" -ForegroundColor DarkGray }
        }
        else {
            $script:Unpaired += $target
            if (-not $Quiet) { Write-Host "   port is open, but the phone rejected this PC" -ForegroundColor Yellow }
        }

        & $adb disconnect $target 2>&1 | Out-Null
    }
    return $null
}

# After every (re)connection: remember the phone's address, open the Metro tunnel.
function Set-Connected([string]$Target) {
    $ip = ($Target -split ":")[0]
    if ($ip -ne $script:SavedPhoneIp) {
        Set-Content -Path $StateFile -Value $ip -Encoding ascii
        $script:SavedPhoneIp = $ip
    }
    $script:PhoneIP = $ip
    # Convenience tunnel for Metro. The app reaches the API over the LAN address
    # in apps/mobile/.env instead, because reverse tunnels are torn down on every
    # reconnect while still showing in `adb reverse --list` - a stale one there
    # is what made OTP fail with "Failed to send code".
    & $adb -s $Target reverse tcp:8081 tcp:8081 2>&1 | Out-Null
}

function Show-ConnectFailure {
    Write-Host "Could not connect." -ForegroundColor Red
    if ($script:Dead.Count -gt 0) { Write-Host "  stale / closed ports     : $($script:Dead -join ', ')" }
    if ($script:Unpaired.Count -gt 0) { Write-Host "  reachable but not paired : $($script:Unpaired -join ', ')" -ForegroundColor Yellow }
    if ($script:Unpaired.Count -gt 0) {
        $ip = ($script:Unpaired[0] -split ":")[0]
        Show-PairingHelp $ip
        if ($ip -ne $script:SavedPhoneIp) {
            Write-Host "On a shared Wi-Fi this may be someone else's phone. Check the IP on your" -ForegroundColor DarkGray
            Write-Host "phone's Wireless debugging screen; if it differs, run:" -ForegroundColor DarkGray
            Write-Host "  npm run connect -- -PhoneIP <your-phone-ip>" -ForegroundColor Cyan
            Write-Host ""
        }
        return
    }
    Write-Host ""
    if ($script:Dead.Count -eq 0) {
        Write-Host "The phone is not advertising wireless debugging."
        Write-Host "  - Phone and PC must be on the SAME Wi-Fi"
        Write-Host "  - Settings > Developer options > Wireless debugging must be ON"
    }
    else {
        Write-Host "Every advertised port was closed, so wireless debugging is off or the"
        Write-Host "phone has moved to a different network."
        Write-Host "  1. Turn Wireless debugging OFF and ON again."
    }
    Write-Host "  If it still fails, pass the address and port from that screen:"
    Write-Host "      npm run connect -- -PhoneIP <ip> -Port <port>" -ForegroundColor Yellow
}

$script:SavedPhoneIp = $DefaultPhoneIP

Write-Host ""
Write-Host "Clearing stale connections..." -ForegroundColor DarkGray
& $adb disconnect | Out-Null

$connected = Connect-Phone $Port $false
Write-Host ""

if ($connected) {
    Set-Connected $connected
    Write-Host "CONNECTED  $connected" -ForegroundColor Green
    Write-Host "Tunnel     8081 (Metro)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Now run:  npx expo start --dev-client" -ForegroundColor Cyan
}
else {
    Show-ConnectFailure
    # Not paired, or asked for one attempt: nothing to wait for.
    if ($Once -or $script:Unpaired.Count -gt 0) { exit 1 }
}

if ($Once) { exit 0 }

# --------------------------------------------------------------------------
# Watch: keep the phone connected
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "Watching the connection - reconnects by itself. Ctrl+C to stop." -ForegroundColor DarkGray

$lastWaitNotice = [DateTime]::MinValue
while ($true) {
    Start-Sleep -Seconds $WatchSeconds

    # The PC moved to another address (new network, new DHCP lease).
    $ip = Get-PcIp $PhoneIP
    if ($ip -and $ip -ne $script:PcIp) {
        $script:PcIp = $ip
        Update-MobileEnv $ip | Out-Null
    }

    if ($connected) {
        $state = (& $adb -s $connected get-state 2>$null | Out-String).Trim()
        if ($state -eq "device") { continue }
        Write-Host "$(Get-Date -Format HH:mm:ss)  Phone dropped ($connected) - reconnecting..." -ForegroundColor Yellow
        & $adb disconnect $connected 2>&1 | Out-Null
        # The same port first: a short Wi-Fi blip keeps it.
        & $adb connect $connected 2>&1 | Out-Null
        Start-Sleep -Milliseconds 800
        $state = (& $adb -s $connected get-state 2>$null | Out-String).Trim()
        if ($state -ne "device") { $connected = $null }
    }

    if (-not $connected) {
        # A new port (wireless debugging toggled, phone rebooted) or a new address.
        $connected = Connect-Phone "" $true
        if (-not $connected) {
            if ($script:Unpaired.Count -gt 0) {
                Show-ConnectFailure
                exit 1
            }
            if (((Get-Date) - $lastWaitNotice).TotalMinutes -ge 1) {
                Write-Host "$(Get-Date -Format HH:mm:ss)  Waiting for the phone (same Wi-Fi, Wireless debugging on)..." -ForegroundColor DarkGray
                $lastWaitNotice = Get-Date
            }
            continue
        }
    }

    Set-Connected $connected
    Write-Host "$(Get-Date -Format HH:mm:ss)  RECONNECTED  $connected  (Metro tunnel reopened)" -ForegroundColor Green
}
