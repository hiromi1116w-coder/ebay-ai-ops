# Step 4 helper: write jp_form_fields_snapshot.json (JP_DUMP_INPUTS=1).
# Optional: first argument = output JSON filename under this folder (JP_SNAPSHOT_FILE).
# Example: .\run_japanpost_dump.ps1 jp_snapshot_step3.json
param([string]$SnapshotFile = "")

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding } catch {}
try { chcp 65001 | Out-Null } catch {}

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $baseDir
try {
  $env:JP_DUMP_INPUTS = "1"
  if ($SnapshotFile) {
    $env:JP_SNAPSHOT_FILE = $SnapshotFile
  }
  node .\autofill_japanpost_playwright.mjs
} finally {
  Remove-Item Env:JP_DUMP_INPUTS -ErrorAction SilentlyContinue
  Remove-Item Env:JP_SNAPSHOT_FILE -ErrorAction SilentlyContinue
  Pop-Location
}