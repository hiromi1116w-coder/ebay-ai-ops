# UK 実務フロー用: 1 SKU チェックリスト + CSV を生成
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$input = Join-Path $PSScriptRoot "listings_input.json"
if (-not (Test-Path $input)) {
  Copy-Item (Join-Path $PSScriptRoot "sample_listing_macross.json") $input
  Write-Host "Created listings_input.json from Macross sample."
}

node (Join-Path $PSScriptRoot "run_uk_checklist.mjs") $input
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Next: open output\uk_checklist_*.md and follow checkboxes in Sellsta."
