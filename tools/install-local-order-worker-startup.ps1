$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartScript = Join-Path $PSScriptRoot "start-local-order-worker.ps1"
$TaskName = "FN OS Local Order Worker"

if (-not (Test-Path $StartScript)) {
  throw "Start script not found: $StartScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Starts FN OS local server and order collection worker for web order collection." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "It will start at Windows logon."
Write-Host "To start it now, run:"
Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
