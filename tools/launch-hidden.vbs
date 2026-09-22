' Silent launcher: runs tools\launch-game.cmd without showing a console window.
' Keep this file pure ASCII -- wscript reads .vbs using the system ANSI codepage,
' and non-ASCII bytes in comments can swallow the following line.
Option Explicit
Dim fso, shell, here, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & here & "\launch-game.cmd"""
shell.Run cmd, 0, False
