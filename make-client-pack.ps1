# =============================================================================
#  Hello Sunlit - build the client modpack zip for Nova Client
#
#  Takes your CurseForge / Prism CLIENT instance and produces the
#  hisunlit-client.zip that the launcher downloads.
#
#  Do NOT point this at the server folder (C:\Sunlitvalley). A server pack is
#  missing the client-only mods, so the game will not start.
#
#  Usage (PowerShell):
#    .\make-client-pack.ps1 -Instance "C:\curseforge\minecraft\Instances\Society Sunlit Valley"
#
#  This file is intentionally ASCII-only: Windows PowerShell 5.1 reads .ps1
#  files as CP949 unless they carry a UTF-8 BOM, which mangles non-ASCII text.
# =============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Instance,

    [string]$Output = "$PSScriptRoot\hisunlit-client.zip"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Instance)) {
    Write-Host "[ERROR] Instance folder not found:" -ForegroundColor Red
    Write-Host "        $Instance"
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $Instance "mods"))) {
    Write-Host "[ERROR] No 'mods' folder inside that path - is it really a modpack instance?" -ForegroundColor Red
    Write-Host "        $Instance"
    exit 1
}

# Folders the launcher unpacks into the player's instance.
#   mods   : required
#   kubejs : strongly recommended - holds the sell prices, must match the server
$folders = @("mods", "config", "kubejs", "defaultconfigs", "resourcepacks", "shaderpacks")

$staging = Join-Path $env:TEMP ("hisunlit-pack-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Host ""
Write-Host "=== Hello Sunlit - client pack builder ===" -ForegroundColor Cyan
Write-Host "Instance: $Instance"
Write-Host ""

foreach ($f in $folders) {
    $srcPath = Join-Path $Instance $f
    if (Test-Path -LiteralPath $srcPath) {
        Write-Host ("  [add ] {0}" -f $f)
        Copy-Item -LiteralPath $srcPath -Destination $staging -Recurse -Force
    }
    else {
        Write-Host ("  [skip] {0}  (not present)" -f $f) -ForegroundColor DarkGray
    }
}

# Server-only files would crash the client if they slipped in.
$junk = @("server.properties", "eula.txt", "ops.json", "whitelist.json",
          "banned-players.json", "banned-ips.json", "usercache.json")
foreach ($j in $junk) {
    $jp = Join-Path $staging $j
    if (Test-Path -LiteralPath $jp) { Remove-Item -LiteralPath $jp -Force }
}

# Ship this instance's own settings as the FIRST-RUN defaults: keybinds, enabled resource
# packs, vsync, fullscreen, shaders. The launcher applies them only on a fresh install - if
# the player already has these files they are restored after unpacking, so nothing a player
# changes is ever overwritten by a later modpack update.
$rootPrefs = @("options.txt", "optionsshaders.txt")
foreach ($pf in $rootPrefs) {
    $src = Join-Path $Instance $pf
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $staging -Force
        Write-Host ("  [add ] {0}  (first-run defaults)" -f $pf)
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $Instance "options.txt"))) {
    Write-Host "  [warn] options.txt not found - run the instance once so it is created" -ForegroundColor Yellow
}

# Show what the first-run defaults actually are, so you can eyeball them before uploading.
$optCheck = Join-Path $Instance "options.txt"
if (Test-Path -LiteralPath $optCheck) {
    foreach ($k in @("fullscreen", "enableVsync")) {
        $hit = Select-String -LiteralPath $optCheck -Pattern ("^" + $k + ":") | Select-Object -First 1
        if ($hit) { Write-Host ("         {0}" -f $hit.Line) -ForegroundColor DarkGray }
    }
    $keyCount = (Select-String -LiteralPath $optCheck -Pattern "^key_").Count
    Write-Host ("         keybinds: {0}" -f $keyCount) -ForegroundColor DarkGray
}
$oculus = Join-Path $Instance "config\oculus.properties"
if (Test-Path -LiteralPath $oculus) {
    $sp = Select-String -LiteralPath $oculus -Pattern "^(shaderPack|enableShaders)="
    foreach ($l in $sp) { Write-Host ("         {0}" -f $l.Line) -ForegroundColor DarkGray }
}
else {
    Write-Host "  [warn] config\oculus.properties not found - shader state may not carry over" -ForegroundColor Yellow
}

# The modpack decides which resource packs are on and in what order. That lives only in
# the instance's options.txt, which we do NOT ship (it also holds the player's own keybinds
# and volume). So copy just the resourcePacks line out into a small manifest the launcher
# reads after unpacking.
$optionsPath = Join-Path $Instance "options.txt"
$manifestPath = Join-Path $staging "nova-resourcepacks.json"
if (Test-Path -LiteralPath $optionsPath) {
    $line = Select-String -LiteralPath $optionsPath -Pattern '^resourcePacks:' | Select-Object -First 1
    if ($line) {
        $json = $line.Line -replace '^resourcePacks:', ''
        try {
            $parsed = $json | ConvertFrom-Json
            $json | Set-Content -LiteralPath $manifestPath -Encoding UTF8 -NoNewline
            Write-Host ("  [pack] default resource packs: {0}" -f ($parsed -join ", ")) -ForegroundColor Green
        }
        catch {
            Write-Host "  [warn] could not parse resourcePacks line - launcher will fall back to folder order" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  [pack] no resourcePacks line in options.txt - none enabled by default" -ForegroundColor DarkGray
    }
}
else {
    Write-Host "  [warn] options.txt not found - run the instance once so it is created" -ForegroundColor Yellow
}

$modCount = (Get-ChildItem -LiteralPath (Join-Path $staging "mods") -Filter *.jar -File).Count

if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }

Write-Host ""
Write-Host "  Compressing $modCount mods - this can take a few minutes..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $Output -CompressionLevel Optimal

Remove-Item -LiteralPath $staging -Recurse -Force

$sizeMB = [math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 1)

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ("  File : {0}" -f $Output)
Write-Host ("  Size : {0} MB" -f $sizeMB)
Write-Host ("  Mods : {0}" -f $modCount)
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. GitHub -> Sil2ntium7012/nova-client -> Releases -> Draft a new release"
Write-Host "  2. Tag it  pack-hisunlit-1.0.0  and attach this zip"
Write-Host "  3. Check that modpack.url in main.js matches the uploaded asset URL"
Write-Host "  4. When you change mods later, bump modpack.version too"
Write-Host ""
