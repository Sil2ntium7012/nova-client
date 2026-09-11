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

    [string]$Output = "$PSScriptRoot\hisunlit-client.zip",

    # Bump the pack version and rewrite modpack.json in one go, e.g. -Version 1.0.3
    # (upload the release FIRST, then commit modpack.json - see the notes at the end)
    [string]$Version,

    # Mods to drop from the pack. Keep this EMPTY unless you know why.
    #
    # A mod that registers a network channel must be on both sides, or Forge kicks every
    # player with "mismatched mod list". This was set to @("securetrade") back at pack
    # 1.0.2, when the client had securetrade and the server did not. The server runs it
    # now (it is the one jar kept out of .gitignore on purpose), so dropping it here would
    # break the pack in the other direction.
    # Match is a substring of the jar file name, case-insensitive.
    [string[]]$ExcludeMods = @()
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

# We do NOT ship options.txt / optionsshaders.txt.
#
# They hold the builder's OWN mouse sensitivity, volumes, FOV, GUI scale and keybinds.
# The launcher restores an existing player's copy after unpacking, so returning players
# were fine - but anyone installing for the FIRST time had no file to restore and got the
# builder's personal settings instead. That is what players reported.
#
# The one thing the pack legitimately needs from options.txt is which resource packs are
# enabled and in what order, and that is exported separately as nova-resourcepacks.json
# a few lines below.
foreach ($pf in @("options.txt", "optionsshaders.txt")) {
    $sp = Join-Path $staging $pf
    if (Test-Path -LiteralPath $sp) {
        Remove-Item -LiteralPath $sp -Force
        Write-Host ("  [drop] {0}  (personal settings - never shipped)" -f $pf) -ForegroundColor Yellow
    }
}

# Personal / machine-specific / runtime leftovers that ride along inside config\.
# None of these are pack settings; they are either the builder's own taste, tied to the
# builder's hardware, or logs that regrow on their own.
$stripConfig = @(
    "config\embeddium-fingerprint.json",        # hash of the BUILDER's GPU+driver
    "config\extremesoundmuffler-client.toml",   # builder's muffled-sound list (volumes)
    "config\voicechat\player-volumes.properties",   # per-player voice volumes
    "config\voicechat\category-volumes.properties",
    "config\voicechat\username-cache.json",
    "config\CSC\CSC_Warn.log",                 # anticheat logs + playtime counters
    "config\CSC\Log\CSC_Record.log",
    "config\CSC\Data\variables.data"
)
foreach ($rel in $stripConfig) {
    $sp = Join-Path $staging $rel
    if (Test-Path -LiteralPath $sp) {
        Remove-Item -LiteralPath $sp -Recurse -Force
        Write-Host ("  [drop] {0}" -f $rel) -ForegroundColor Yellow
    }
}
# Any other *.log that slipped in with config\.
Get-ChildItem -LiteralPath (Join-Path $staging "config") -Filter *.log -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host ("  [drop] {0}" -f $_.FullName.Substring($staging.Length + 1)) -ForegroundColor Yellow
    }

# servers.dat - the server list. We ship a clean one holding ONLY our server, built from
# nova-servers.dat next to this script (never the builder's own list, which would leak and
# overwrite every other server a player has saved). main.js keeps servers.dat in its
# USER_PREF_FILES, so a player who already has a list keeps it on later pack updates;
# only a fresh install gets ours.
$serversSrc = Join-Path $PSScriptRoot "nova-servers.dat"
if (Test-Path -LiteralPath $serversSrc) {
    Copy-Item -LiteralPath $serversSrc -Destination (Join-Path $staging "servers.dat") -Force
    Write-Host "  [add ] servers.dat  (our server only)" -ForegroundColor Green
}
else {
    Write-Host "  [warn] nova-servers.dat not found next to this script - servers.dat not shipped" -ForegroundColor Yellow
}

# Report the shader state the pack carries (config\oculus.properties IS shipped on purpose -
# the shader choice is a pack decision, and the launcher restores a player's own file).
$oculus = Join-Path $Instance "config\oculus.properties"
if (Test-Path -LiteralPath $oculus) {
    $sp2 = Select-String -LiteralPath $oculus -Pattern "^(shaderPack|enableShaders)="
    foreach ($l in $sp2) { Write-Host ("         {0}" -f $l.Line) -ForegroundColor DarkGray }
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

# Drop the mods the server does not run (see -ExcludeMods above).
$stagedMods = Join-Path $staging "mods"
foreach ($ex in $ExcludeMods) {
    if ([string]::IsNullOrWhiteSpace($ex)) { continue }
    $hits = Get-ChildItem -LiteralPath $stagedMods -Filter *.jar -File |
            Where-Object { $_.Name -like ("*" + $ex + "*") }
    if ($hits) {
        foreach ($h in $hits) {
            Remove-Item -LiteralPath $h.FullName -Force
            Write-Host ("  [drop] {0}  (excluded: {1})" -f $h.Name, $ex) -ForegroundColor Yellow
        }
    }
    else {
        Write-Host ("  [drop] nothing matched '{0}' - already gone?" -f $ex) -ForegroundColor DarkGray
    }
}

$modCount = (Get-ChildItem -LiteralPath $stagedMods -Filter *.jar -File).Count

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
if ($Version) {
    # The launcher reads modpack.json from the repo (raw.githubusercontent .../main/modpack.json)
    # and falls back to the values baked into main.js. Bumping it here is what makes every
    # player re-download the pack on their next launch.
    $mpPath = Join-Path $PSScriptRoot "modpack.json"
    $url = "https://github.com/Sil2ntium7012/nova-client/releases/download/pack-hisunlit-$Version/hisunlit-client.zip"
    $mp = @{}
    if (Test-Path -LiteralPath $mpPath) {
        $existing = Get-Content -LiteralPath $mpPath -Raw | ConvertFrom-Json
        foreach ($prop in $existing.PSObject.Properties) {
            $mp[$prop.Name] = @{ version = $prop.Value.version; url = $prop.Value.url }
        }
    }
    $mp["hisunlit"] = @{ version = $Version; url = $url }
    $json = $mp | ConvertTo-Json -Depth 5
    # No BOM - this file is fetched and parsed as JSON by the launcher.
    [System.IO.File]::WriteAllText($mpPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ("  modpack.json -> hisunlit {0}" -f $Version) -ForegroundColor Green
    Write-Host ("  url          -> {0}" -f $url) -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. GitHub -> Sil2ntium7012/nova-client -> Releases -> Draft a new release"
if ($Version) {
    Write-Host ("  2. Tag it  pack-hisunlit-{0}  and attach this zip" -f $Version)
    Write-Host "  3. AFTER the upload finishes, commit and push modpack.json"
    Write-Host "     (push it earlier and every launcher will try to download a file that is not there yet)"
}
else {
    Write-Host "  2. Tag it  pack-hisunlit-<version>  and attach this zip"
    Write-Host "  3. AFTER the upload finishes, set that version+url in modpack.json and push"
    Write-Host "     (or just rerun this script with  -Version <version>  and it writes modpack.json for you)"
}
Write-Host "  4. Players pick it up on their next launch - no launcher update needed"
Write-Host ""
