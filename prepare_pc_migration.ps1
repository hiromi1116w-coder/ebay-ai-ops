# PC migration prep: local backup + git push (no secrets / PII in git)
# Run from repo root:  .\prepare_pc_migration.ps1

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding; chcp 65001 | Out-Null } catch {}

$root = $PSScriptRoot
$logPath = Join-Path $root "migration_run.log"

function Write-Log([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Invoke-Git {
  param([string[]]$GitArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & git -C $root @GitArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Out = $out; Code = $code }
}

# Discover 05_* folder without hardcoding Japanese in this script file
$labelDirItem = Get-ChildItem -LiteralPath $root -Directory |
  Where-Object { $_.Name -like "05_*" } |
  Select-Object -First 1
if (-not $labelDirItem) {
  throw "Folder matching 05_* not found under $root"
}
$labelDir = $labelDirItem.FullName
$labelDirName = $labelDirItem.Name

$backupRoot = Join-Path ([Environment]::GetFolderPath("Desktop")) "eBay-AI-Ops-Migration-Backup"
$backupLabelDir = Join-Path $backupRoot $labelDirName

Set-Location $root
Write-Log "=== PC migration prep started ==="
Write-Log "Repo root: $root"
Write-Log "Label dir: $labelDirName"

# --- 1) Local backup ---
New-Item -ItemType Directory -Force -Path $backupLabelDir | Out-Null

$localNames = @(
  "sample_order.json",
  "label_input.json",
  "jp_autofill_run_log.jsonl",
  "japanpost_auth.json",
  "jp_form_fields_snapshot.json"
)
foreach ($name in $localNames) {
  $src = Join-Path $labelDir $name
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $backupLabelDir $name) -Force
    Write-Log "Backed up: $labelDirName\$name"
  } else {
    Write-Log "Skip (not found): $labelDirName\$name"
  }
}

Get-ChildItem -LiteralPath $labelDir -Filter "jp_snapshot_*.json" -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $backupLabelDir $_.Name) -Force
  Write-Log "Backed up: $labelDirName\$($_.Name)"
}

foreach ($rel in @("HANDOFF.md", "docs\SECRETS_BACKUP_CHECKLIST.md")) {
  $src = Join-Path $root $rel
  if (Test-Path -LiteralPath $src) {
    $dest = Join-Path $backupRoot $rel
    $destDir = Split-Path -Parent $dest
    if ($destDir -and -not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }
    Copy-Item -LiteralPath $src -Destination $dest -Force
    Write-Log "Backed up: $rel"
  }
}

$secretsTemplate = @"
# Secrets template - fill in and store in a password manager (never commit)

eBay Client ID (Production):
eBay Client Secret (Production):
RuName:
Redirect URL (ngrok):
Privacy Policy URL:

User Access Token:
Refresh Token (if any):
Token obtained date:
redirect_uri (exact):

ngrok URL / account:

Japan Post login ID:
Japan Post password notes:

GitHub account:
"@
Set-Content -Path (Join-Path $backupRoot "secrets_TEMPLATE.txt") -Value $secretsTemplate -Encoding UTF8
Write-Log "Created: secrets_TEMPLATE.txt (fill in manually)"
Write-Log "Backup folder: $backupRoot"

# --- 2) Untrack PII using paths returned by git (avoids encoding issues) ---
$list = Invoke-Git @("ls-files")
if ($list.Code -eq 0) {
  $pii = @($list.Out) | Where-Object { $_ -match "(sample_order|label_input)\.json$" }
  foreach ($p in $pii) {
    $rm = Invoke-Git @("rm", "--cached", "--", $p)
    if ($rm.Code -eq 0) {
      Write-Log "Removed from git index (kept locally): $p"
    } else {
      Write-Log "git rm --cached failed for: $p"
    }
  }
  if (-not $pii.Count) {
    Write-Log "No sample_order.json / label_input.json in git index (OK)."
  }
}

# --- 3) Stage all safe changes (.gitignore excludes PII/secrets/node_modules) ---
$add = Invoke-Git @("add", "-A")
if ($add.Code -ne 0) {
  Write-Log "git add -A failed: $($add.Out -join ' ')"
  throw "git add failed"
}

Write-Log "--- git status ---"
$st = Invoke-Git @("status", "-sb")
$st.Out | ForEach-Object { Write-Log $_ }

$diff = Invoke-Git @("diff", "--cached", "--quiet")
if ($diff.Code -eq 0) {
  Write-Log "No staged changes to commit."
} else {
  $commit = Invoke-Git @(
    "commit", "-m",
    "PC migration handoff: HANDOFF, secrets checklist, gitignore PII."
  )
  if ($commit.Code -eq 0) {
    Write-Log "Committed."
  } else {
    Write-Log "Commit failed: $($commit.Out -join ' ')"
  }
}

Write-Log "--- git push ---"
$push = Invoke-Git @("push", "-u", "origin", "HEAD")
if ($push.Code -eq 0) {
  Write-Log "Push succeeded."
} else {
  Write-Log "Push failed: $($push.Out -join ' ')"
  Write-Log "Retry: git push -u origin HEAD"
}

Write-Log "=== Done. Copy Desktop\eBay-AI-Ops-Migration-Backup to USB ==="
