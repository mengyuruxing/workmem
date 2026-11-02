' start-panel.example.vbs - 隐藏窗口启动 workmem 面板（默认端口 8795）
' 复制成 start-panel.vbs 后双击即可；想换数据目录，先设置环境变量 WORKMEM_ROOT。
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node.exe """ & here & "\start-panel.mjs""", 0, False
