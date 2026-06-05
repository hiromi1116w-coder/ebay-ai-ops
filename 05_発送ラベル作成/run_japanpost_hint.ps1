# Print selector hints from jp_form_fields_snapshot.json (after jp:dump).

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try { [Console]::OutputEncoding = $OutputEncoding; chcp 65001 | Out-Null } catch {}



$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $baseDir

try {

  node .\jp_hint_from_dump.mjs @args

} finally {

  Pop-Location

}


