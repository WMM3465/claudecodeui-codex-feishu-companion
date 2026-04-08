$ErrorActionPreference = 'Stop'

$launcherHome = Join-Path $env:LOCALAPPDATA 'FeishuCodexLauncher'
New-Item -ItemType Directory -Force -Path $launcherHome | Out-Null
$logPath = Join-Path $launcherHome 'launcher.log'

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    Add-Content -Path $logPath -Value "[$timestamp] $Message"
}

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-DaemonRunning {
    param([string]$DaemonPath)
    $needle = $DaemonPath.ToLowerInvariant()
    $running = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle)
    }
    return [bool]$running
}

function Wait-Workspace {
    param(
        [string]$Url,
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Write-Log "Wait probe failed: $($_.Exception.Message)"
            if (Test-PortListening -Port $Port) {
                Write-Log "Port $Port is listening; continuing despite probe failure."
                return $true
            }
            Start-Sleep -Milliseconds 500
        }
    }

    if (Test-PortListening -Port $Port) {
        Write-Log "Port $Port is listening at timeout; continuing."
        return $true
    }

    return $false
}

function Open-WorkspaceUrl {
    param([string]$Url)

    $errors = @()

    foreach ($strategy in @(
        { Start-Process -FilePath $Url },
        { Start-Process -FilePath 'explorer.exe' -ArgumentList $Url },
        { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start', '', $Url -WindowStyle Hidden },
        { Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-Command', "Start-Process '$Url'" -WindowStyle Hidden }
    )) {
        try {
            & $strategy
            return
        } catch {
            $errors += $_.Exception.Message
        }
    }

    throw "Unable to open workspace URL: $Url. Errors: $($errors -join ' | ')"
}

try {
    Clear-Content -Path $logPath -ErrorAction SilentlyContinue
    Write-Log 'Launcher started.'

    $configPath = Join-Path $PSScriptRoot 'launcher-config.json'
    if (-not (Test-Path $configPath)) {
        throw "Config file not found: $configPath"
    }

    $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
    Write-Log "Loaded config from: $configPath"
    Write-Log "cloudCliRoot=$($config.cloudCliRoot)"
    Write-Log "cloudCliEntry=$($config.cloudCliEntry)"

    if (-not (Test-Path $config.nodePath)) {
        throw "Node path does not exist: $($config.nodePath)"
    }

    $serverEntry = Join-Path $config.cloudCliRoot $config.cloudCliEntry
    Write-Log "Resolved serverEntry=$serverEntry"
    Write-Log "serverEntryExists=$([bool](Test-Path $serverEntry))"
    if (-not (Test-Path $serverEntry)) {
        throw "Workspace entry does not exist: $serverEntry"
    }

    if (-not (Test-PortListening -Port $config.cloudCliPort)) {
        Write-Log "Port $($config.cloudCliPort) not listening. Starting workspace server."
        Start-Process -WindowStyle Hidden -FilePath $config.nodePath -ArgumentList $config.cloudCliEntry -WorkingDirectory $config.cloudCliRoot | Out-Null
    } else {
        Write-Log "Port $($config.cloudCliPort) already listening."
    }

    if ($config.startBridge -and $config.bridgeDaemonPath) {
        if (-not (Test-Path $config.bridgeDaemonPath)) {
            throw "Bridge daemon does not exist: $($config.bridgeDaemonPath)"
        }

        if (-not (Test-DaemonRunning -DaemonPath $config.bridgeDaemonPath)) {
            $daemonDir = Split-Path -Parent $config.bridgeDaemonPath
            Write-Log 'Bridge daemon not running. Starting daemon.'
            Start-Process -WindowStyle Hidden -FilePath $config.nodePath -ArgumentList $config.bridgeDaemonPath -WorkingDirectory $daemonDir | Out-Null
        } else {
            Write-Log 'Bridge daemon already running.'
        }
    }

    Write-Log "Waiting for workspace: $($config.cloudCliUrl)"
    if (-not (Wait-Workspace -Url $config.cloudCliUrl -Port $config.cloudCliPort -TimeoutSeconds $config.waitTimeoutSeconds)) {
        throw "Workspace did not become ready in time: $($config.cloudCliUrl)"
    }

    Write-Log 'Workspace ready. Opening browser.'
    Open-WorkspaceUrl -Url $config.cloudCliUrl
    Write-Log 'Browser open request sent.'
} catch {
    Write-Log "Launcher failed: $($_.Exception.Message)"
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Feishu Codex Launcher') | Out-Null
    exit 1
}
