[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\OBS-Setup-Assistant-Windows-x64.exe')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
if ([IO.Path]::GetExtension($destination) -ine '.exe' -or (Test-Path -LiteralPath $destination -PathType Container)) {
    throw 'OutputPath must be an executable filename.'
}

function Invoke-Checked([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program exited with code $LASTEXITCODE." }
}

$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$runtime = & $node -p "process.platform + ' ' + process.arch + ' ' + process.version"
if ($runtime -ne 'win32 x64 v24.18.0') { throw "Use Windows x64 Node.js v24.18.0 for this build. Found $runtime." }
$npm = (Get-Command npm.cmd -CommandType Application | Select-Object -First 1).Source
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$scratch = Join-Path $tempRoot ('obs-setup-build-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
try {
    # Use the pinned native Windows build of esbuild directly.
    [IO.Directory]::CreateDirectory((Join-Path $scratch 'node_modules\@esbuild')) | Out-Null
    Invoke-Checked $npm @('install', '--prefix', $scratch, '--no-save', '--no-package-lock', '--ignore-scripts',
        '--no-audit', '--no-fund', '@esbuild/win32-x64@0.28.1', 'postject@1.0.0-alpha.6', 'commander@9.5.0')
    $esbuild = Join-Path $scratch 'node_modules\@esbuild\win32-x64\esbuild.exe'
    $postject = Join-Path $scratch 'node_modules\postject\dist\cli.js'
    $bundle = Join-Path $scratch 'server.cjs'
    Push-Location -LiteralPath $project
    try {
        # Source-only import.meta.url branches are guarded by isSea().
        Invoke-Checked $esbuild @('server.js', '--bundle', '--platform=node', '--target=node24', '--format=cjs',
            '--log-override:empty-import-meta=silent', "--outfile=$bundle")
    } finally { Pop-Location }

    $assets = [ordered]@{}
    foreach ($file in @('index.html', 'style.css', 'app.js', 'advisor.js', 'assets/Silkscreen-Bold.ttf', 'assets/obs-setup.ico')) {
        $assets[$file] = Join-Path $project $file
    }
    $config = [ordered]@{
        main = 'server.cjs'
        output = 'app.blob'
        disableExperimentalSEAWarning = $true
        useCodeCache = $false
        useSnapshot = $false
        execArgvExtension = 'none'
        assets = $assets
    }
    [IO.File]::WriteAllText((Join-Path $scratch 'sea.json'), ($config | ConvertTo-Json -Depth 4))

    Push-Location -LiteralPath $scratch
    try {
        Invoke-Checked $node @('--experimental-sea-config', 'sea.json')
        Copy-Item -LiteralPath $node -Destination 'assistant.exe'
        # postject removes Authenticode when it replaces the resources in the build copy.
        Invoke-Checked $node @($postject, 'assistant.exe', 'NODE_SEA_BLOB', 'app.blob',
            '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2')
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        Copy-Item -LiteralPath 'assistant.exe' -Destination $destination -Force
    } finally { Pop-Location }
    Get-FileHash -Algorithm SHA256 -LiteralPath $destination
} finally {
    $resolvedScratch = (Resolve-Path -LiteralPath $scratch).Path
    if ([IO.Path]::GetDirectoryName($resolvedScratch) -ieq $tempRoot.TrimEnd('\') -and
        [IO.Path]::GetFileName($resolvedScratch) -match '^obs-setup-build-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
