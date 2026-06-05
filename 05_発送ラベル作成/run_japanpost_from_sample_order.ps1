param(
  [switch]$RunAutofill
)

# Step 6: if sample_order.json exists, run build_label_input.ps1; check weight/size; optionally run autofill.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $OutputEncoding } catch {}
try { chcp 65001 | Out-Null } catch {}

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$orderPath = Join-Path $baseDir "sample_order.json"
$buildScript = Join-Path $baseDir "build_label_input.ps1"

Push-Location $baseDir
try {
  if (Test-Path $orderPath) {
    Write-Host "Running build_label_input.ps1 ..."
    & $buildScript
    Write-Host ""
    Write-Host "Edit label_input.json: set weightGrams and sizeCm (often missing from eBay)."
    if ($RunAutofill) {
      Write-Host "RunAutofill: starting node autofill_japanpost_playwright.mjs ..."
      node .\autofill_japanpost_playwright.mjs
    } else {
      Write-Host "Then run: node .\autofill_japanpost_playwright.mjs"
      Write-Host "Or:       .\run_japanpost_from_sample_order.ps1 -RunAutofill"
    }
  } else {
    Write-Host "sample_order.json not found. Save an order JSON first, or edit label_input.json by hand."
  }
} finally {
  Pop-Location
}
