' Launches run-agent.cmd with no visible console window, so the agent
' starts silently in the background when Windows logs the user in.
Set objShell = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
objShell.Run """" & scriptDir & "run-agent.cmd""", 0, False
