$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $here "AbuZamelPOS.exe"
$iconPng = Join-Path $here "icon.ico"

if (!(Test-Path $batPath)) {
  throw "لم يتم العثور على الملف: $batPath"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "AbuZamel POS.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($lnkPath)
$shortcut.TargetPath = $batPath
$shortcut.WorkingDirectory = $here
$shortcut.WindowStyle = 1
$shortcut.Description = "تشغيل نظام أبو زامل (POS)"
if (Test-Path $iconPng) {
  $shortcut.IconLocation = $iconPng
} else {
  $shortcut.IconLocation = "$batPath,0"
}
$shortcut.Save()

Write-Host "تم إنشاء اختصار على سطح المكتب:"
Write-Host $lnkPath

