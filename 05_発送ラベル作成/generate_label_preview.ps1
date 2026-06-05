$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputPath = Join-Path $baseDir "label_input.json"
$htmlPath = Join-Path $baseDir "label_preview.html"

if (-not (Test-Path $inputPath)) {
  Write-Error "label_input.json が見つかりません: $inputPath"
  exit 1
}

$label = Get-Content $inputPath -Raw | ConvertFrom-Json

function Esc([string]$v) {
  if ($null -eq $v) { return "" }
  return [System.Net.WebUtility]::HtmlEncode($v)
}

$html = @"
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>Shipping Label Preview</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; }
    .card { width: 900px; border: 2px solid #222; padding: 16px; }
    .title { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    .row { display: flex; margin: 6px 0; }
    .k { width: 180px; font-weight: 700; }
    .v { flex: 1; }
    .mono { font-family: Consolas, monospace; }
    .block { margin-top: 14px; border-top: 1px solid #999; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">JapanPost Label Preview (Demo)</div>

    <div class="row"><div class="k">Order ID</div><div class="v mono">$(Esc $label.orderId)</div></div>
    <div class="row"><div class="k">Carrier</div><div class="v">$(Esc $label.carrier)</div></div>
    <div class="row"><div class="k">Receiver Name</div><div class="v">$(Esc $label.buyerName)</div></div>
    <div class="row"><div class="k">Postal Code</div><div class="v">$(Esc $label.postalCode)</div></div>
    <div class="row"><div class="k">Country</div><div class="v">$(Esc $label.countryCode)</div></div>
    <div class="row"><div class="k">State/Province</div><div class="v">$(Esc $label.stateOrProv)</div></div>
    <div class="row"><div class="k">City</div><div class="v">$(Esc $label.city)</div></div>
    <div class="row"><div class="k">Address 1</div><div class="v">$(Esc $label.addressLine1)</div></div>
    <div class="row"><div class="k">Address 2</div><div class="v">$(Esc $label.addressLine2)</div></div>
    <div class="row"><div class="k">Phone</div><div class="v">$(Esc $label.phone)</div></div>

    <div class="block">
      <div class="row"><div class="k">Item Title</div><div class="v">$(Esc $label.itemTitle)</div></div>
      <div class="row"><div class="k">Quantity</div><div class="v">$(Esc $label.quantity)</div></div>
      <div class="row"><div class="k">HS Code</div><div class="v">$(Esc $label.hsCode)</div></div>
      <div class="row"><div class="k">Weight (g)</div><div class="v">$(Esc $label.weightGrams)</div></div>
      <div class="row"><div class="k">Size (cm)</div><div class="v">$(Esc $label.sizeCm)</div></div>
    </div>

    <div class="block">
      <div class="row"><div class="k">VAT</div><div class="v">$(Esc $label.vatNumber)</div></div>
      <div class="row"><div class="k">IOSS</div><div class="v">$(Esc $label.iossNumber)</div></div>
      <div class="row"><div class="k">RUT</div><div class="v">$(Esc $label.rutNumber)</div></div>
    </div>
  </div>
</body>
</html>
"@

$html | Out-File $htmlPath -Encoding utf8
Write-Host "Done: $htmlPath"
Write-Host "Open in browser, then Print -> Save as PDF."
