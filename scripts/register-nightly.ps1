# Registers a Windows scheduled task that runs `npm run nightly` every morning.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts\register-nightly.ps1 [-Time 06:30]
# Remove it with:                    Unregister-ScheduledTask -TaskName "NHL Fantasy Analyzer nightly" -Confirm:$false
param([string]$Time = "06:30")

$project = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Force (Join-Path $project "data\logs") | Out-Null

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c `"`"$npm`" run nightly >> data\logs\nightly-task.log 2>&1`"" `
  -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off or asleep at the scheduled time, run as soon as it's back.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "NHL Fantasy Analyzer nightly" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Fetches last night's NHL games and refreshes projections, grades and alerts." -Force | Out-Null

Write-Host "Registered 'NHL Fantasy Analyzer nightly' to run daily at $Time from $project"
