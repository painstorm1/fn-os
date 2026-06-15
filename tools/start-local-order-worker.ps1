$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeCommand = Get-Command node -ErrorAction Stop
$NodeExe = $NodeCommand.Source
$Port = 3000
$LocalOrigin = $env:FN_WORKER_EXECUTION_ORIGIN
$ProdOrigin = $env:FN_OS_ORIGIN

if (-not $LocalOrigin) {
  $LocalOrigin = "http://localhost:$Port"
}

if (-not $ProdOrigin) {
  $ProdOrigin = "https://fn-os.vercel.app"
}

function Test-LocalPort {
  param([int]$TargetPort)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $result = $client.BeginConnect("127.0.0.1", $TargetPort, $null, $null)
    $success = $result.AsyncWaitHandle.WaitOne(250)
    if ($success) {
      $client.EndConnect($result)
    }
    $client.Close()
    return $success
  } catch {
    return $false
  }
}

function Wait-LocalPort {
  param([int]$TargetPort, [int]$TimeoutSeconds = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort -TargetPort $TargetPort) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Test-WorkerRunning {
  $escapedRepo = [Regex]::Escape($RepoRoot.Path)
  $processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue
  return [bool]($processes | Where-Object {
    $_.CommandLine -match "automation-worker\.mjs" -and $_.CommandLine -match $escapedRepo
  } | Select-Object -First 1)
}

if (-not (Test-LocalPort -TargetPort $Port)) {
  Start-Process `
    -FilePath $NodeExe `
    -ArgumentList @("node_modules\next\dist\bin\next", "dev", "-H", "127.0.0.1", "-p", "$Port") `
    -WorkingDirectory $RepoRoot.Path `
    -WindowStyle Hidden
}

if (-not (Wait-LocalPort -TargetPort $Port)) {
  throw "Local FN OS server did not open on port $Port."
}

if (-not (Test-WorkerRunning)) {
  $oldOrigin = $env:FN_OS_ORIGIN
  $oldExecutionOrigin = $env:FN_WORKER_EXECUTION_ORIGIN
  try {
    $env:FN_OS_ORIGIN = $ProdOrigin
    $env:FN_WORKER_EXECUTION_ORIGIN = $LocalOrigin
    Start-Process `
      -FilePath $NodeExe `
      -ArgumentList @("tools\automation-worker.mjs") `
      -WorkingDirectory $RepoRoot.Path `
      -WindowStyle Hidden
  } finally {
    $env:FN_OS_ORIGIN = $oldOrigin
    $env:FN_WORKER_EXECUTION_ORIGIN = $oldExecutionOrigin
  }
}

Write-Host "FN OS local order worker is ready."
Write-Host "Web origin: $ProdOrigin"
Write-Host "Local execution origin: $LocalOrigin"
