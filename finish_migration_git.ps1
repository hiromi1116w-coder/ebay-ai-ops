# Git-only recovery after prepare_pc_migration.ps1 failed on Japanese paths.
# Run:  .\finish_migration_git.ps1

$root = $PSScriptRoot
Set-Location $root
chcp 65001 | Out-Null

Write-Host "Untrack PII (if tracked)..."
$tracked = git ls-files 2>$null
$pii = $tracked | Where-Object { $_ -match "(sample_order|label_input)\.json$" }
foreach ($p in $pii) {
  git rm --cached -- $p
  Write-Host "  removed from index: $p"
}
if (-not $pii) { Write-Host "  (none in git index)" }

Write-Host "git add -A ..."
git add -A

Write-Host "git status -sb"
git status -sb

git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "PC migration handoff: HANDOFF, secrets checklist, gitignore PII."
  git push -u origin HEAD
  Write-Host "Done."
} else {
  Write-Host "Nothing to commit. Try: git push -u origin HEAD"
}
