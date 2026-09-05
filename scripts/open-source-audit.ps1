[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

Push-Location $repoRoot
try {
  $required = @(
    'LICENSE', 'README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
    'SECURITY.md', 'PRIVACY.md', 'GOVERNANCE.md', 'CHANGELOG.md', '.env.example',
    'backend/.env.example', 'docs/OPEN_SOURCE_RELEASE_CHECKLIST.md', 'THIRD_PARTY_ASSETS.md'
  )
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative) -PathType Leaf)) {
      $failures.Add("Missing required open-source file: $relative")
    }
  }

  $candidateOutput = & git ls-files --cached --others --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
  $candidates = @($candidateOutput | Where-Object { $_ -and $_.Trim() })

  $forbiddenNames = @('.env', '.env.local', 'backend/.env')
  foreach ($name in $forbiddenNames) {
    if ($candidates -contains $name) { $failures.Add("Sensitive environment file would be committed: $name") }
  }

  $forbiddenExtensions = @('.db', '.sqlite', '.sqlite3', '.apk', '.aab', '.jks', '.keystore', '.p8', '.p12', '.pem', '.key')
  $forbiddenBiometricArtifacts = @(
    'e2e/photo-fitting-test/landmarks.json',
    'e2e/photo-fitting-test/report.json'
  )
  $allowedRuntimeModels = @('public/avatar/AvatarSample_G.glb', 'public/avatar/Mage.glb')
  foreach ($relative in $candidates) {
    $fullPath = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
    $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
    $normalizedRelative = $relative.Replace('\', '/')
    if ($forbiddenBiometricArtifacts -contains $normalizedRelative) {
      $failures.Add("Biometric QA artifact derived from real photos would be committed: $relative")
    }
    if ($forbiddenExtensions -contains $extension) {
      $failures.Add("Forbidden binary or sensitive artifact would be committed: $relative")
    }
    if (($extension -eq '.glb' -or $extension -eq '.vrm' -or $extension -eq '.zip') -and -not ($allowedRuntimeModels -contains $relative)) {
      $failures.Add("Unreviewed or duplicate model/archive would be committed: $relative")
    }
    $size = (Get-Item -LiteralPath $fullPath).Length
    if ($size -gt 50MB) {
      $failures.Add("File over 50 MB would be committed: $relative ($([math]::Round($size / 1MB, 1)) MB)")
    } elseif ($size -gt 15MB) {
      $warnings.Add("Large file needs provenance and Git LFS review: $relative ($([math]::Round($size / 1MB, 1)) MB)")
    }
  }

  $textExtensions = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.ps1', '.yml', '.yaml', '.txt', '.html', '.xml', '.example')
  $secretPattern = '(?i)(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,})'
  # Reject drive-qualified local paths anywhere in publishable text. URL schemes such
  # as https:// are excluded because the first slash is immediately followed by '/'.
  $absolutePathPattern = '(?i)[A-Z]:(?:\\{1,2}|/)(?!/)(?:[^\\/\s:*?"<>|]+(?:\\{1,2}|/))*[^\\/\s:*?"<>|]+'
  foreach ($relative in $candidates) {
    $fullPath = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
    $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
    if (-not ($textExtensions -contains $extension) -or (Get-Item -LiteralPath $fullPath).Length -gt 5MB) { continue }
    $content = Get-Content -LiteralPath $fullPath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $content) { continue }
    if ($content -match $secretPattern) { $failures.Add("Possible real secret: $relative") }
    if ($content -match $absolutePathPattern) { $failures.Add("Local user path would break portability: $relative") }
  }

  foreach ($model in $allowedRuntimeModels) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $model) -PathType Leaf)) {
      $failures.Add("Reviewed runtime model is missing: $model")
    }
  }

  Write-Host "Open-source candidate files: $($candidates.Count)"
  foreach ($warning in ($warnings | Sort-Object -Unique)) { Write-Warning $warning }
  if ($failures.Count -gt 0) {
    foreach ($failure in ($failures | Sort-Object -Unique)) { Write-Error $failure -ErrorAction Continue }
    Write-Host "Open-source audit failed: $($failures.Count) high-risk finding(s)." -ForegroundColor Red
    exit 1
  }
  Write-Host "Open-source audit passed: no candidate secrets, databases, APKs, private keys, or oversized files." -ForegroundColor Green
  exit 0
}
finally {
  Pop-Location
}
