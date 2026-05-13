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

function Get-PathRelativeTo {
  param([string]$Base, [string]$Full)
  $b = $Base.TrimEnd('\', '/')
  $f = (Resolve-Path -LiteralPath $Full).Path
  if (-not $f.StartsWith($b, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path not under base: $Full vs $Base"
  }
  $rest = $f.Substring($b.Length).TrimStart('\', '/')
  return ($rest -replace '\\', '/')
}

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

$prefixed = $localNames | ForEach-Object { "05_発送ラベル作成/$_" }

$paths = @()
foreach ($p in $prefixed) {
  $abs = Join-Path $root ($p -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (Test-Path -LiteralPath $abs) { $paths += $p }
}

if (-not $paths.Count) {
  $candidates = @(
    (Join-Path $root "05_発送ラベル作成"),
    $here
  ) | Select-Object -Unique
  foreach ($dir in $candidates) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($n in $localNames) {
      $abs = Join-Path $dir $n
      if (Test-Path -LiteralPath $abs) {
        $paths += (Get-PathRelativeTo -Base $root -Full $abs)
      }
    }
    if ($paths.Count) { break }
  }
}

$paths = $paths | Select-Object -Unique
$existing = $paths | Where-Object { Test-Path -LiteralPath (Join-Path $root ($_ -replace '/', [IO.Path]::DirectorySeparatorChar)) }
if (-not $existing.Count) {
  throw "None of the expected Japan Post files found under $root. Run from repo root or 05_発送ラベル作成, and ensure files exist."
}

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
