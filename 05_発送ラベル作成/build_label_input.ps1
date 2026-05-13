$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$orderPath = Join-Path $baseDir "sample_order.json"
$outPath = Join-Path $baseDir "label_input.json"

if (-not (Test-Path $orderPath)) {
  Write-Error "sample_order.json not found: $orderPath"
  exit 1
}

$order = Get-Content $orderPath -Raw | ConvertFrom-Json

function To-Ascii([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "" }
  $normalized = $s.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($ch)
    }
  }
  # Example conversion rule requested: sharp-s to ss
  ($sb.ToString() -replace ([string][char]0x00DF), 'ss' -replace '[^\u0020-\u007E]', '')
}

function Limit([string]$s, [int]$maxLen) {
  if ($null -eq $s) { return "" }
  if ($s.Length -le $maxLen) { return $s }
  return $s.Substring(0, $maxLen)
}

$shipTo = $null
if ($order.fulfillmentStartInstructions -and $order.fulfillmentStartInstructions.Count -gt 0) {
  $shipTo = $order.fulfillmentStartInstructions[0].shippingStep.shipTo
}
if (-not $shipTo -and $order.shippingAddress) { $shipTo = $order.shippingAddress }
if (-not $shipTo -and $order.buyer -and $order.buyer.buyerRegistrationAddress) { $shipTo = $order.buyer.buyerRegistrationAddress }

$addr = $null
if ($shipTo -and $shipTo.contactAddress) { $addr = $shipTo.contactAddress } else { $addr = $shipTo }

$title = To-Ascii($order.lineItems[0].title)
$title = Limit $title 80
if ($title -notmatch 'NO battery') { $title = "$title NO battery" }

$label = [pscustomobject]@{
  orderId      = $order.orderId
  carrier      = "JapanPost"
  shippingService = ""
  cpassStage   = "paid_list"
  buyerName    = Limit (To-Ascii($shipTo.fullName)) 50
  postalCode   = $addr.postalCode
  countryCode  = $addr.countryCode
  countrySelectLabel = ""
  stateOrProv  = Limit (To-Ascii($addr.stateOrProvince)) 40
  city         = Limit (To-Ascii($addr.city)) 40
  addressLine1 = Limit (To-Ascii($addr.addressLine1)) 60
  addressLine2 = Limit (To-Ascii($addr.addressLine2)) 60
  phone        = $shipTo.primaryPhone.phoneNumber
  itemTitle    = $title
  quantity     = $order.lineItems[0].quantity
  vatNumber    = ""
  iossNumber   = ""
  rutNumber    = ""
  taxCode      = ""
  referenceNumber = ""
  step4FlightWeightGrams = ""
  billableWeightGrams = ""
  hsCode       = ""
  hsCodeRequired = $false
  originCountryCode = ""
  unitPriceJpy = ""
  jpShipmentSelectValue = ""
  hasBattery   = $false
  batteryType  = ""
  weightGrams  = ""
  sizeCm       = ""
}

$label | ConvertTo-Json -Depth 5 | Out-File $outPath -Encoding utf8
Write-Host "Done: $outPath"
Write-Host "Hint: if country <select> fails, set label_input countrySelectLabel to exact option text, or add countryOptionLabels in playwright_selectors_japanpost.sample.json."
