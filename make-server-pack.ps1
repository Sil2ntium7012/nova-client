# =============================================================================
#  Hello Sunlit - build the server folder zip to hand to the person hosting
#
#  Zips C:\Sunlitvalley into Downloads, skipping the world, the logs and
#  everything the server regenerates on its own first run.
#
#  Usage (PowerShell):
#    .\make-server-pack.ps1
#
#  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as CP949
#  unless they carry a UTF-8 BOM, which mangles non-ASCII text.
# =============================================================================

param(
    [string]$Source = "C:\Sunlitvalley",
    [string]$Output = "$env:USERPROFILE\Downloads\hisunlit-server.zip"
)

$ErrorActionPreference = "Stop"

# Top-level folders left out of the zip.
#   world*          : the friend's server generates a fresh world
#   libraries, .git : regenerated on first run / not needed by the friend
#   the rest        : logs, caches and runtime state
$skipDirs = @(
    "world", "world_nether", "world_the_end",
    "logs", "backups", "crash-reports",
    "libraries", ".git", ".mixin.out", "local",
    "configureddefaults", "journeymap", "modernfix", "easy_npc",
    "moonlight-global-datapacks", "quests_structures"
)

# Files left out. server.jar / run.* / user_jvm_args.txt are written by
# start.bat on first run, so the friend gets fresh correct ones.
$skipFiles = @(
    "server.jar", "run.bat", "run.sh", "run.ps1", "user_jvm_args.txt",
    "rhino.local.properties", "ears-debug.log",
    "ops.json", "whitelist.json", "usercache.json", "usernamecache.json",
    "banned-players.json", "banned-ips.json"
)
$skipExt = @(".log", ".gz")

if (-not (Test-Path -LiteralPath $Source)) {
    Write-Host "[ERROR] Server folder not found: $Source" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Hello Sunlit - server pack builder ===" -ForegroundColor Cyan
Write-Host "Source: $Source"
Write-Host "Output: $Output"
Write-Host ""
Write-Host "Scanning..." -ForegroundColor Yellow

$root = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\') + '\'
$all  = Get-ChildItem -LiteralPath $Source -Recurse -File -Force

$picked = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($f in $all) {
    $rel = $f.FullName.Substring($root.Length)
    $top = $rel.Split('\')[0]

    if ($skipDirs  -contains $top)      { continue }
    if ($skipFiles -contains $f.Name)   { continue }
    if ($skipExt   -contains $f.Extension.ToLower()) { continue }
    if ($f.Name -like "forge-*-installer.jar")       { continue }

    $picked.Add($f)
}

$totalMB = [math]::Round((($picked | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Host ("  {0} files, {1} MB before compression" -f $picked.Count, $totalMB)
Write-Host ""
Write-Host "Compressing - this takes a few minutes, leave the window open..." -ForegroundColor Yellow

if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
$outDir = Split-Path -Parent $Output
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($Output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $i = 0
    foreach ($f in $picked) {
        $rel = $f.FullName.Substring($root.Length)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $f.FullName, $rel,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $i++
        if ($i % 100 -eq 0) {
            Write-Progress -Activity "Compressing" -Status "$i / $($picked.Count)" `
                -PercentComplete (($i / $picked.Count) * 100)
        }
    }
}
finally {
    $zip.Dispose()
    Write-Progress -Activity "Compressing" -Completed
}

$sizeMB = [math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 1)

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ("  File  : {0}" -f $Output)
Write-Host ("  Size  : {0} MB" -f $sizeMB)
Write-Host ("  Files : {0}" -f $picked.Count)
Write-Host ""
Write-Host "Tell your friend:" -ForegroundColor Cyan
Write-Host "  1. Unzip to a path with NO spaces and NO Korean, e.g.  C:\Sunlitvalley"
Write-Host "  2. Run start.bat  (first run downloads Java, takes about 5 minutes)"
Write-Host "  3. Allow it in the Windows Firewall prompt"
Write-Host "  4. Router: forward TCP 25565 and UDP 24454 to that PC"
Write-Host ""
