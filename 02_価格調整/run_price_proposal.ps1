# 価格提案 CSV を生成（反映はしない）
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

$input = Join-Path $Root "listings_input.json"
if (-not (Test-Path $input)) {
  Copy-Item (Join-Path $Root "sample_listing.json") $input
  Write-Host "Created listings_input.json from sample. Edit with real data and re-run."
}

node (Join-Path $Root "run_price_proposal.mjs") $input
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Open output\price_proposals_*.csv in Excel."
