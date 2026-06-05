param(
  [string]$AccessToken = ""
)

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sampleOrderPath = Join-Path $baseDir "sample_order.json"
$buildScript = Join-Path $baseDir "build_label_input.ps1"
$previewScript = Join-Path $baseDir "generate_label_preview.ps1"

if (-not $AccessToken) {
  if ($env:EBAY_ACCESS_TOKEN) {
    $AccessToken = $env:EBAY_ACCESS_TOKEN
  }
}

if (-not $AccessToken) {
  Write-Error "Access token is required. Pass -AccessToken or set EBAY_ACCESS_TOKEN."
  exit 1
}

Write-Host "Step 1/3: Fetch latest order from eBay..."
$resp = Invoke-RestMethod -Method Get -Uri "https://api.ebay.com/sell/fulfillment/v1/order?limit=1" -Headers @{ Authorization = "Bearer $AccessToken" }
if (-not $resp.orders -or $resp.orders.Count -eq 0) {
  Write-Error "No orders found."
  exit 1
}

$resp.orders[0] | ConvertTo-Json -Depth 10 | Out-File $sampleOrderPath -Encoding utf8
Write-Host "Saved: $sampleOrderPath"

Write-Host "Step 2/3: Build label_input.json..."
try {
  & $buildScript
} catch {
  Write-Error "build_label_input.ps1 failed: $($_.Exception.Message)"
  exit 1
}
if (-not (Test-Path (Join-Path $baseDir "label_input.json"))) {
  Write-Error "build_label_input.ps1 failed: label_input.json was not created."
  exit 1
}

Write-Host "Step 3/3: Build label_preview.html..."
try {
  & $previewScript
} catch {
  Write-Error "generate_label_preview.ps1 failed: $($_.Exception.Message)"
  exit 1
}
if (-not (Test-Path (Join-Path $baseDir "label_preview.html"))) {
  Write-Error "generate_label_preview.ps1 failed: label_preview.html was not created."
  exit 1
}

Write-Host "Done. Open label_preview.html and Print -> Save as PDF."
