[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CertificatePath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2OTlsVerificationEnabled
  if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
    throw "The selected CA bundle does not exist: $CertificatePath"
  }
  $resolved = (Resolve-Path -LiteralPath $CertificatePath).Path
  $pem = Get-Content -Raw -LiteralPath $resolved
  if ($pem -notmatch '(?s)-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----') {
    throw 'The selected CA bundle must be PEM-encoded and contain at least one X.509 certificate.'
  }

  $target = Join-Path $projectRoot '.a2o-secrets\node-extra-ca.pem'
  $normalizedPem = $pem.Trim() + [Environment]::NewLine
  $null = Write-A2OTextFileAtomic -Path $target -Text $normalizedPem -ProtectAsSecret
  Set-A2ONodeTrustedCaBundle -CertificatePath $target
  Write-Output 'Local Node trust bundle enrolled. It is used only by A2O local commands and remains outside Git.'
} finally {
  Pop-Location
}
