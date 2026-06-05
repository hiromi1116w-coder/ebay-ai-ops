# Step 4: clear JP_DUMP_INPUTS, then run Japan Post autofill end-to-end.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding } catch {}
try { chcp 65001 | Out-Null } catch {}

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $baseDir
try {
  Remove-Item Env:JP_DUMP_INPUTS -ErrorAction SilentlyContinue
  Write-Host "Cleared JP_DUMP_INPUTS. Running node autofill_japanpost_playwright.mjs ..."
  node .\autofill_japanpost_playwright.mjs @args
} finally {
  Pop-Location
}
