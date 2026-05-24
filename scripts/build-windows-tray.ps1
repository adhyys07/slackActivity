$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (!(Test-Path $csc)) {
  $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (!(Test-Path $csc)) {
  throw "Could not find .NET Framework csc.exe"
}

New-Item -ItemType Directory -Force -Path "$repo\dist" | Out-Null
New-Item -ItemType Directory -Force -Path "$repo\.tmp" | Out-Null
$env:TEMP = "$repo\.tmp"
$env:TMP = "$repo\.tmp"

$agent = "$repo\dist\slack-activity-agent-win-x64.exe"
if (!(Test-Path $agent)) {
  throw "Build dist\slack-activity-agent-win-x64.exe before building the tray app."
}

& $csc `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /optimize+ `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /out:"$repo\dist\SlackActivity.exe" `
  "$repo\src\windows-tray\SlackActivityTray.cs"

if ($LASTEXITCODE -ne 0) {
  throw "Failed to compile SlackActivity.exe"
}

$marker = [Text.Encoding]::ASCII.GetBytes("SLACK_ACTIVITY_AGENT_PAYLOAD_V2")
$output = "$repo\dist\SlackActivity.exe"
$stream = [IO.File]::Open($output, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try {
  $agentBytes = [IO.File]::ReadAllBytes($agent)
  $stream.Write($agentBytes, 0, $agentBytes.Length)
  $sizeBytes = [BitConverter]::GetBytes([Int64]$agentBytes.Length)
  $stream.Write($sizeBytes, 0, $sizeBytes.Length)
  $stream.Write($marker, 0, $marker.Length)
}
finally {
  $stream.Dispose()
}
