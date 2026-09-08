# =============================================================================
#  Hello Sunlit - one command to ship a modpack update
#
#  What it does, in order
#    1. copies C:\Sunlitvalley\kubejs  ->  <instance>\kubejs   (merge, no delete)
#    2. copies the mods in $ExtraMods if the instance is missing them
#    3. builds hisunlit-client.zip
#    4. bumps the modpack version in modpack.json  (1.0.0 -> 1.0.1 -> ...)
#    5. creates a GitHub release and uploads the zip        (needs the gh CLI)
#    6. commits and pushes modpack.json
#
#  Usage (PowerShell, from the Nova-Client folder):
#    .\update-client.ps1
#
#  Options:
#    -Version 1.2.0     pin the new modpack version instead of auto-bumping
#    -SkipBuild         reuse the existing zip (skip steps 1-3)
#    -NoPublish         do everything locally, don't touch GitHub (steps 5-6)
#    -Instance "path"   client instance path, if auto-detect fails
#
#  The gh CLI is only needed for step 5. Install once with:
#    winget install --id GitHub.cli
#    gh auth login
#  Without it the script still does 1-4 and tells you the two manual steps.
#
#  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as CP949 unless the
#  file carries a UTF-8 BOM, which mangles non-ASCII text.
# =============================================================================

param(
    [string]$Instance = "",
    [string]$Server   = "C:\Sunlitvalley",
    [string]$Version  = "",
    [switch]$SkipBuild,
    [switch]$NoPublish
)

$ErrorActionPreference = "Stop"

$ServerId   = "hisunlit"
$Repo       = "Sil2ntium7012/nova-client"
$ZipPath    = Join-Path $PSScriptRoot "hisunlit-client.zip"
$ManifestPath = Join-Path $PSScriptRoot "modpack.json"

# Mods that live on the server but the client instance may not have yet.
$ExtraMods = @(
    "securetrade-forge-1.3.0-1.20.1.jar"
)

function Step($n, $text) { Write-Host ("[{0}] {1}" -f $n, $text) -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Hello Sunlit - modpack release ===" -ForegroundColor Cyan

# ---------------------------------------------------------------- steps 1-3
if (-not $SkipBuild) {

    if (-not $Instance) {
        $candidates = @(
            "$env:USERPROFILE\curseforge\minecraft\Instances\Society Sunlit Valley",
            "C:\curseforge\minecraft\Instances\Society Sunlit Valley",
            "D:\curseforge\minecraft\Instances\Society Sunlit Valley",
            "$env:APPDATA\.minecraft\instances\Society Sunlit Valley",
            "$env:APPDATA\PrismLauncher\instances\Society Sunlit Valley\.minecraft"
        )
        foreach ($c in $candidates) {
            if (Test-Path -LiteralPath (Join-Path $c "mods")) { $Instance = $c; break }
        }
    }
    if (-not $Instance -or -not (Test-Path -LiteralPath (Join-Path $Instance "mods"))) {
        Write-Host "[ERROR] Could not find the client instance." -ForegroundColor Red
        Write-Host '        .\update-client.ps1 -Instance "C:\curseforge\minecraft\Instances\Society Sunlit Valley"'
        exit 1
    }
    if (-not (Test-Path -LiteralPath $Server)) {
        Write-Host "[ERROR] Server folder not found: $Server" -ForegroundColor Red
        exit 1
    }

    Write-Host "Server  : $Server"
    Write-Host "Instance: $Instance"
    Write-Host ""

    Step "1/6" "Copying kubejs (overwrite, nothing deleted)..."
    $src = Join-Path $Server "kubejs"
    $dst = Join-Path $Instance "kubejs"
    if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
    $null = robocopy $src $dst /E /NFL /NDL /NJH /NJS /R:1 /W:1
    if ($LASTEXITCODE -ge 8) {
        Write-Host "      robocopy failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    Write-Host "      done." -ForegroundColor Green

    Step "2/6" "Checking mods..."
    $copied = 0
    foreach ($m in $ExtraMods) {
        $from = Join-Path (Join-Path $Server "mods") $m
        $to   = Join-Path (Join-Path $Instance "mods") $m
        if (-not (Test-Path -LiteralPath $from)) { Write-Host "      [skip] $m" -ForegroundColor DarkGray; continue }
        if (Test-Path -LiteralPath $to)          { Write-Host "      [ ok ] $m" -ForegroundColor DarkGray; continue }
        Copy-Item -LiteralPath $from -Destination $to -Force
        Write-Host "      [add ] $m" -ForegroundColor Green
        $copied++
    }
    Write-Host ("      {0} mod(s) added." -f $copied)

    Step "3/6" "Building the client pack..."
    $builder = Join-Path $PSScriptRoot "make-client-pack.ps1"
    if (-not (Test-Path -LiteralPath $builder)) {
        Write-Host "[ERROR] make-client-pack.ps1 not found next to this script." -ForegroundColor Red
        exit 1
    }
    & $builder -Instance $Instance
}
else {
    Write-Host "(-SkipBuild: reusing the existing zip)" -ForegroundColor DarkGray
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
    Write-Host "[ERROR] hisunlit-client.zip not found: $ZipPath" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------- step 4
Step "4/6" "Bumping the modpack version..."

if (Test-Path -LiteralPath $ManifestPath) {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
} else {
    $manifest = [pscustomobject]@{}
}

$oldVersion = "0.0.0"
if ($manifest.PSObject.Properties.Name -contains $ServerId) {
    $oldVersion = [string]$manifest.$ServerId.version
}

if ($Version) {
    $newVersion = $Version
} else {
    $parts = $oldVersion.Split(".")
    while ($parts.Count -lt 3) { $parts += "0" }
    $parts[2] = [string]([int]$parts[2] + 1)
    $newVersion = ($parts -join ".")
}

$tag = "pack-$ServerId-$newVersion"
$url = "https://github.com/$Repo/releases/download/$tag/hisunlit-client.zip"

$entry = [pscustomobject]@{ version = $newVersion; url = $url }
if ($manifest.PSObject.Properties.Name -contains $ServerId) {
    $manifest.$ServerId = $entry
} else {
    $manifest | Add-Member -NotePropertyName $ServerId -NotePropertyValue $entry
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

$sizeMB = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 1)
Write-Host ("      {0} -> {1}   (tag {2}, {3} MB)" -f $oldVersion, $newVersion, $tag, $sizeMB) -ForegroundColor Green

if ($NoPublish) {
    Write-Host ""
    Write-Host "(-NoPublish: stopping here. modpack.json is updated but not pushed.)" -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------- step 5
Step "5/6" "Creating the GitHub release and uploading the zip..."

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Host ""
    Write-Host "      gh CLI is not installed, so the upload was skipped." -ForegroundColor Yellow
    Write-Host "      Install it once and this whole script becomes fully automatic:" -ForegroundColor Yellow
    Write-Host "        winget install --id GitHub.cli"
    Write-Host "        gh auth login"
    Write-Host ""
    Write-Host "      For now, do these two by hand:" -ForegroundColor Cyan
    Write-Host ("        1. New GitHub release, tag  {0}  and attach:" -f $tag)
    Write-Host ("           {0}" -f $ZipPath)
    Write-Host "        2. git add modpack.json; git commit -m 'modpack $newVersion'; git push"
    exit 0
}

Write-Host "      uploading $sizeMB MB, this takes a while..." -ForegroundColor DarkGray
& gh release create $tag $ZipPath --repo $Repo --title "Modpack $newVersion" --notes "Hello Sunlit client modpack $newVersion"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] gh release create failed. modpack.json was changed but not pushed." -ForegroundColor Red
    Write-Host "        Fix the release, then run:  git add modpack.json; git commit -m 'modpack $newVersion'; git push"
    exit 1
}
Write-Host "      released." -ForegroundColor Green

# ---------------------------------------------------------------- step 6
Step "6/6" "Pushing modpack.json..."
& git -C $PSScriptRoot add modpack.json
& git -C $PSScriptRoot commit -m "modpack $newVersion"
if ($LASTEXITCODE -ne 0) { Write-Host "      nothing to commit." -ForegroundColor DarkGray }
& git -C $PSScriptRoot push
if ($LASTEXITCODE -ne 0) {
    # A branch with no upstream yet - set it and retry once.
    Write-Host "      no upstream set, retrying with --set-upstream..." -ForegroundColor DarkGray
    & git -C $PSScriptRoot push --set-upstream origin HEAD
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] git push failed - the release is up but players will not see it yet." -ForegroundColor Red
    Write-Host "        Run this by hand:  git push --set-upstream origin main"
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ("  Modpack {0} is live. Players get it on their next PLAY." -f $newVersion)
Write-Host "  No launcher rebuild needed."
