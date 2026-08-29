# Registers the Remote Print Agent to start automatically at Windows logon
# (spec section 35), using a Scheduled Task rather than a full Windows
# Service - no admin rights needed, and it's visible/removable from the
# normal Task Scheduler UI.
#
# Usage: right-click this file -> Run with PowerShell, or from a terminal:
#   powershell -ExecutionPolicy Bypass -File install-startup.ps1

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptDir 'run-agent-hidden.vbs'
$taskName = 'RemotePrintAgent'

if (-not (Test-Path $launcher)) {
    throw "Expected launcher not found: $launcher"
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'Starts the Remote Print Agent at logon so printers are available without manually launching it.' | Out-Null

Write-Host "Installed. The Remote Print Agent will start automatically the next time you log in."
Write-Host "To start it right now without logging out:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "To remove it later, run uninstall-startup.ps1 in this same folder."
