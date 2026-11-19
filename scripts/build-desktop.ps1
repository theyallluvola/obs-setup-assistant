[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\OBS-Setup-Assistant-Desktop.exe')
)

$ErrorActionPreference = 'Stop'
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
if ([IO.Path]::GetExtension($destination) -ine '.exe') { throw 'OutputPath must be an executable filename.' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\desktop\ObsSetupAssistant.csproj')).Path
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$scratch = Join-Path $tempRoot ('obs-desktop-build-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
try {
    $engine = Join-Path $scratch 'engine.exe'
    & (Join-Path $PSScriptRoot 'build-windows.ps1') -OutputPath $engine | Out-Host
    $nuget = Join-Path $scratch 'NuGet.Config'
    [IO.File]::WriteAllText($nuget, '<configuration><packageSources><clear/><add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>')
    $publish = Join-Path $scratch 'publish'
    dotnet publish $project -c Release -o $publish "-p:AssistantEngine=$engine" "-p:RestoreConfigFile=$nuget" -p:NuGetAuditMode=direct
    if ($LASTEXITCODE -ne 0) { throw 'The desktop app build failed.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath (Join-Path $publish 'OBS-Setup-Assistant-Desktop.exe') -Destination $destination -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $destination
} finally {
    $checked = (Resolve-Path -LiteralPath $scratch).Path
    if ([IO.Path]::GetDirectoryName($checked) -ieq $tempRoot -and
        [IO.Path]::GetFileName($checked) -match '^obs-desktop-build-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $checked -Recurse -Force
    }
}
