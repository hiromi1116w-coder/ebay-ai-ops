# Stages only Japan Post autofill-related files, commits, optionally merges master, pushes.
# Run from repo root OR this folder. Requires: git, network for push.
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding; chcp 65001 | Out-Null } catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = $here
for ($i = 0; $i -lt 8; $i++) {
  if (Test-Path (Join-Path $root ".git")) { break }
  $parent = Split-Path -Parent $root
  if ($parent -eq $root) { throw "No .git found above $here" }
  $root = $parent
}
Set-Location $root
Write-Host "Git root: $root"

$prefixed = @(
  "05_発送ラベル作成/autofill_japanpost_playwright.mjs",
  "05_発送ラベル作成/playwright_selectors_japanpost.sample.json",
  "05_発送ラベル作成/label_input.json",
  "05_発送ラベル作成/build_label_input.ps1",
  "05_発送ラベル作成/STEPS_4_5_6.txt",
  "05_発送ラベル作成/jp_form_fields_snapshot.json",
  "05_発送ラベル作成/run_dump.mjs",
  "05_発送ラベル作成/package.json",
  "05_発送ラベル作成/commit_japanpost_autofill.ps1"
)
$localNames = @(
  "autofill_japanpost_playwright.mjs",
  "playwright_selectors_japanpost.sample.json",
  "label_input.json",
  "build_label_input.ps1",
  "STEPS_4_5_6.txt",
  "jp_form_fields_snapshot.json",
  "run_dump.mjs",
  "package.json",
  "commit_japanpost_autofill.ps1"
)

$paths = @()
foreach ($p in $prefixed) {
  if (Test-Path (Join-Path $root $p)) { $paths += $p }
}
if (-not $paths.Count) {
  $sub = Join-Path $root "05_発送ラベル作成"
  if (Test-Path $sub) {
    foreach ($n in $localNames) {
      if (Test-Path (Join-Path $sub $n)) { $paths += "05_発送ラベル作成/$n" }
    }
  }
}

$existing = $paths | Where-Object { Test-Path (Join-Path $root $_) }
if (-not $existing.Count) { throw "None of the expected paths exist under $root (wrong repo root?)" }

git add -- @existing
git status
$msg = if ($env:JP_COMMIT_MSG) { $env:JP_COMMIT_MSG } else { "Japan Post autofill: steps 4-5, dump v2, wizard fallback" }
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host "Nothing staged (no changes)."; exit 0 }
git commit -m $msg

if ($env:JP_SKIP_MERGE_MASTER -ne "1") {
  git fetch origin master 2>$null
  if ($LASTEXITCODE -eq 0) {
    git merge origin/master --no-edit 2>$null
  }
}

if ($env:JP_SKIP_PUSH -ne "1") {
  git push -u origin HEAD
}

Write-Host "Done."
