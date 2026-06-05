# Run Japan Post Playwright autofill from this folder.
# Prereq: npm i, npx playwright install chromium
# Optional env: JP_CONNECT_CDP, JP_USER_DATA_DIR, JP_SAVE_AUTH, JP_DUMP_INPUTS, JP_VERBOSE, JP_NO_LOG
# Step 4 no-dump: .\run_japanpost_through.ps1
# DOM dump: npm run jp:dump  or  .\run_japanpost_dump.ps1

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding } catch {}
try { chcp 65001 | Out-Null } catch {}

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $baseDir
try {
  if (-not (Test-Path (Join-Path $baseDir "node_modules\playwright"))) {
    Write-Error "Playwright not installed. Run: npm i"
    exit 1
  }
  node .\autofill_japanpost_playwright.mjs @args
} finally {
  Pop-Location
}
