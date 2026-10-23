Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
node = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\nvm\v22.14.0\node.exe"
If Not fso.FileExists(node) Then node = "node"
sh.Run """" & node & """ server.mjs", 0, False
