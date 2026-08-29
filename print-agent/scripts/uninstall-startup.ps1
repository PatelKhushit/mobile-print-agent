# Removes the auto-start Scheduled Task installed by install-startup.ps1.
# Does not stop an already-running agent process - close its window (or
# Stop-Process) separately if one is currently open.

$taskName = 'RemotePrintAgent'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed. The Remote Print Agent will no longer start automatically at logon."
