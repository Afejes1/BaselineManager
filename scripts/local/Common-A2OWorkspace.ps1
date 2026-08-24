Set-StrictMode -Version Latest

$script:A2OProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_PATH = Join-Path $script:A2OProjectRoot '.wrangler\logs'
$env:WRANGLER_SEND_METRICS = 'false'
$env:DO_NOT_TRACK = '1'
# Miniflare otherwise refreshes Request.cf from workers.cloudflare.com. The
# local operator runtime does not need Cloudflare request metadata, so prohibit
# that fetch rather than relying on an offline fallback after a failed request.
$env:CLOUDFLARE_CF_FETCH_ENABLED = 'false'
$env:npm_config_cache = Join-Path $script:A2OProjectRoot '.npm-cache'
# Do not make optional npm audit, funding, or update-notification calls during
# local setup. Package acquisition is still an explicit operator action.
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_update_notifier = 'false'
$env:npm_config_prefer_offline = 'true'

function Get-A2OProjectRoot {
  return $script:A2OProjectRoot
}

function Assert-A2ONodeVersion {
  $rawVersion = (& node --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $rawVersion) {
    throw 'Node.js is required. Install Node.js 22.13.0 or newer.'
  }

  $normalized = ([string]$rawVersion).Trim().TrimStart('v')
  try { $installed = [version]$normalized } catch {
    throw "Unable to read the installed Node.js version: $rawVersion"
  }
  $minimum = [version]'22.13.0'
  if ($installed -lt $minimum) {
    throw "Node.js $minimum or newer is required. Installed: $installed"
  }
  Write-Output "Node.js $installed"
}

function Assert-A2OTlsVerificationEnabled {
  if ([string]$env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') {
    throw 'NODE_TLS_REJECT_UNAUTHORIZED=0 is not permitted. Enroll the approved PEM CA bundle with npm run local:certificate:trust instead.'
  }
}

function Set-A2ONodeTrustedCaBundle {
  param([Parameter(Mandatory=$true)][string]$CertificatePath)

  Assert-A2OTlsVerificationEnabled
  if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
    throw "The selected CA bundle does not exist: $CertificatePath"
  }
  $resolved = (Resolve-Path -LiteralPath $CertificatePath).Path
  $pem = Get-Content -Raw -LiteralPath $resolved
  if ($pem -notmatch '(?s)-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----') {
    throw 'The selected CA bundle must be PEM-encoded and contain at least one X.509 certificate.'
  }
  $env:NODE_EXTRA_CA_CERTS = $resolved
  Write-Output 'Using the operator-enrolled PEM CA bundle for this Node process. TLS certificate verification remains enabled.'
}

function Invoke-A2OCommand {
  param(
    [Parameter(Mandatory=$true)][scriptblock]$Command,
    [Parameter(Mandatory=$true)][string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Assert-A2ONoPendingMigrations {
  param([string]$PersistTo = '.wrangler/state')

  $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $script:A2OProjectRoot 'drizzle') -Filter '*.sql' -File | Select-Object -ExpandProperty Name)
  $migrationJson = (& npx --no-install wrangler d1 execute DB --config wrangler.local-runtime.jsonc --local --persist-to $PersistTo --command 'SELECT name FROM d1_migrations ORDER BY id;' --json) | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'The applied migration set could not be read.' }
  try { $migrationResult = $migrationJson | ConvertFrom-Json } catch { throw 'The applied migration set was not valid JSON.' }
  $applied = @($migrationResult[0].results | ForEach-Object { [string]$_.name })
  $pending = @($migrationFiles | Where-Object { $_ -notin $applied })
  $unexpected = @($applied | Where-Object { $_ -notin $migrationFiles })
  if ($pending.Count -or $unexpected.Count) {
    throw "Migration set mismatch. Pending: $($pending -join ', '); not present in this package: $($unexpected -join ', '). Run the explicit backed-up update procedure before starting."
  }
  Write-Output "Migration set verified: $($applied.Count) applied, none pending."
}

function Assert-A2ORuntimeStopped {
  param([int]$Port = 3000)

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count) {
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    throw "The A2O runtime must be stopped before this operation. Port $Port is listening (process $($processIds -join ', '))."
  }
}

function Assert-A2OStateUnlocked {
  param([Parameter(Mandatory=$true)][string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath -PathType Container)) { return }
  foreach ($file in Get-ChildItem -LiteralPath $StatePath -File -Recurse) {
    $stream = $null
    try {
      $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    } catch {
      throw "Local workspace state is still open by another process: $($file.FullName). Stop the runtime and retry; no state was moved."
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }
}

function Assert-A2OCleanSource {
  $status = (& git status --porcelain=v1 --untracked-files=all 2>$null) | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'The Git source state could not be inspected.' }
  if ($status.Trim()) { throw 'The local release source has uncommitted files. Commit or remove them, rebuild, and verify before operating program data.' }
}

function Get-A2ORelativePath {
  param(
    [Parameter(Mandatory=$true)][string]$BasePath,
    [Parameter(Mandatory=$true)][string]$ChildPath
  )
  $base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\')
  $child = [System.IO.Path]::GetFullPath($ChildPath)
  $prefix = $base + '\'
  if (-not $child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside its expected base: $child" }
  return $child.Substring($prefix.Length).Replace('\','/')
}

function Get-A2OFileSha256 {
  param([Parameter(Mandatory=$true)][string]$Path)
  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Get-A2OTextSha256 {
  param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-A2OJsonProperty {
  param(
    [Parameter(Mandatory=$true)][AllowNull()]$Object,
    [Parameter(Mandatory=$true)][string]$Name
  )
  if ($null -eq $Object) { return $null }
  if ($Object -is [System.Collections.IDictionary]) {
    if (-not $Object.Contains($Name)) { return $null }
    return $Object[$Name]
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Write-A2OTextFileAtomic {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text,
    [switch]$ProtectAsSecret,
    [switch]$NoOverwrite
  )

  $absolutePath = [System.IO.Path]::GetFullPath($Path)
  $directory = [System.IO.Path]::GetDirectoryName($absolutePath)
  if (-not $directory) { throw "The target file does not have a parent directory: $absolutePath" }
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporaryPath = Join-Path $directory ".$([System.IO.Path]::GetFileName($absolutePath)).$([guid]::NewGuid().ToString('N')).tmp"
  $replacementBackupPath = Join-Path $directory ".$([System.IO.Path]::GetFileName($absolutePath)).$([guid]::NewGuid().ToString('N')).rollback"
  $temporaryCreated = $false
  try {
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($Text)
    if ([System.Text.Encoding]::ASCII.GetString($bytes) -ne $Text) { throw 'The protected file content must contain ASCII characters only.' }
    $stream = [System.IO.File]::Open($temporaryPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $temporaryCreated = $true
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
    if ($ProtectAsSecret) { Protect-A2OSecretFile -Path $temporaryPath }

    if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
      if ($NoOverwrite) { throw "The target file already exists and was not overwritten: $absolutePath" }
      if ($ProtectAsSecret) { Repair-A2OSecretFileAcl -Path $absolutePath }
      [System.IO.File]::Replace($temporaryPath, $absolutePath, $replacementBackupPath)
      $temporaryCreated = $false
      if ($ProtectAsSecret) { Repair-A2OSecretFileAcl -Path $replacementBackupPath }
      [System.IO.File]::Delete($replacementBackupPath)
    } else {
      [System.IO.File]::Move($temporaryPath, $absolutePath)
      $temporaryCreated = $false
    }
    if ($ProtectAsSecret) { Assert-A2OSecretFileAcl -Path $absolutePath }
    return $absolutePath
  } catch {
    if ($temporaryCreated -and (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
      [System.IO.File]::Delete($temporaryPath)
    }
    if (Test-Path -LiteralPath $replacementBackupPath -PathType Leaf) { [System.IO.File]::Delete($replacementBackupPath) }
    throw
  }
}

function Write-A2OProtectedSecretTextAtomic {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Text,
    [switch]$NoOverwrite
  )
  return Write-A2OTextFileAtomic -Path $Path -Text $Text -ProtectAsSecret -NoOverwrite:$NoOverwrite
}

function Protect-A2OSecretFile {
  param([Parameter(Mandatory=$true)][string]$Path)
  try {
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
    $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
    # Build a DACL-only descriptor instead of mutating the descriptor returned
    # by Get-Acl. Reapplying a descriptor that carries a SACL can require the
    # SeSecurityPrivilege even though this operation changes access rules only.
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    Assert-A2OSecretFileAcl -Path $Path
  } catch {
    throw "The secret file ACL could not be restricted to the operator, Local System, and local Administrators: $Path. $($_.Exception.Message)"
  }
}

function Assert-A2OSecretFileAcl {
  param([Parameter(Mandatory=$true)][string]$Path)
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
  $allowedSids = @($currentSid.Value, $systemSid.Value, $administratorsSid.Value)
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw "Secret-file ACL inheritance is enabled: $Path" }
  $currentUserHasFullControl = $false
  foreach ($rule in @($acl.Access)) {
    $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $ruleSid -notin $allowedSids) { throw "The secret file has an unexpected ACL principal: $Path ($ruleSid)" }
    if ($ruleSid -eq $currentSid.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $currentUserHasFullControl = $true }
  }
  if (-not $currentUserHasFullControl) { throw "The current operator does not have explicit full control of the secret file: $Path" }
}

function Repair-A2OSecretFileAcl {
  param([Parameter(Mandatory=$true)][string]$Path)
  try {
    Assert-A2OSecretFileAcl -Path $Path
    return
  } catch {
    Protect-A2OSecretFile -Path $Path
  }
  Assert-A2OSecretFileAcl -Path $Path
}

function Get-A2OTransferSigningMaterial {
  $secretDirectory = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.a2o-secrets') -ProjectRoot $script:A2OProjectRoot
  $secretPath = Assert-A2OProjectPath -Candidate (Join-Path $secretDirectory 'workspace-transfer-signing.key') -ProjectRoot $script:A2OProjectRoot
  if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    throw 'The workspace transfer signing key is missing. Run npm run local:init on the trusted workstation.'
  }
  $key = (Get-Content -Raw -LiteralPath $secretPath).Trim()
  if ($key -notmatch '^[0-9a-f]{64}$') { throw 'The workspace transfer signing key is invalid.' }
  $keyBytes = [System.Text.Encoding]::UTF8.GetBytes($key)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { $fingerprint = ([System.BitConverter]::ToString($algorithm.ComputeHash($keyBytes))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
  return [pscustomobject]@{ Key = $key; KeyBytes = $keyBytes; KeyId = "a2o-local-$($fingerprint.Substring(0,16))"; Path = $secretPath }
}

function Initialize-A2OTransferSigningMaterial {
  param([switch]$AuthorizedLegacyTrustEstablishment)
  $secretDirectory = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.a2o-secrets') -ProjectRoot $script:A2OProjectRoot
  $secretPath = Assert-A2OProjectPath -Candidate (Join-Path $secretDirectory 'workspace-transfer-signing.key') -ProjectRoot $script:A2OProjectRoot
  $legacyDevVarsPath = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.dev.vars') -ProjectRoot $script:A2OProjectRoot
  $statePath = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.wrangler\state') -ProjectRoot $script:A2OProjectRoot
  if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    if (Test-Path -LiteralPath $legacyDevVarsPath -PathType Leaf) {
      throw 'A legacy runtime-secret file exists while the signing trust-root file is missing. Recover the matching trust root from approved escrow or remove the stale file only after confirming no signed recovery artifacts depend on it.'
    }
    if ((Test-Path -LiteralPath $statePath -PathType Container) -and -not $AuthorizedLegacyTrustEstablishment) {
      throw 'Operational workspace state exists while its signing trust root is missing. Import the escrowed key, or use the documented explicit legacy trust-establishment command. Initialization will not silently rotate the recovery trust root.'
    }
    $recoverableArtifacts = @()
    foreach ($candidateDirectory in @('backups','work','outputs')) {
      $candidatePath = Join-Path $script:A2OProjectRoot $candidateDirectory
      if (Test-Path -LiteralPath $candidatePath -PathType Container) {
        $recoverableArtifacts += @(Get-ChildItem -LiteralPath $candidatePath -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.zip','.a2oworkspace') })
      }
    }
    $signedArtifacts = @()
    $legacyArtifacts = @()
    $invalidArtifacts = @()
    if ($recoverableArtifacts.Count) {
      Add-Type -AssemblyName System.IO.Compression
      Add-Type -AssemblyName System.IO.Compression.FileSystem
    }
    foreach ($artifact in $recoverableArtifacts) {
      $artifactArchive = $null
      try {
        if ($artifact.Length -le 0 -or $artifact.Length -gt 5GB) { throw 'unsupported archive size' }
        $artifactArchive = [System.IO.Compression.ZipFile]::OpenRead($artifact.FullName)
        $manifestEntries = @($artifactArchive.Entries | Where-Object { $_.FullName -eq 'manifest.json' })
        if ($manifestEntries.Count -ne 1 -or $manifestEntries[0].Length -le 0 -or $manifestEntries[0].Length -gt 1MB) { throw 'missing or oversized manifest' }
        if (@($artifactArchive.Entries | Where-Object { $_.FullName -eq 'signature.json' }).Count -eq 1) { $signedArtifacts += $artifact; continue }
        $manifestStream = $manifestEntries[0].Open()
        $manifestReader = [System.IO.StreamReader]::new($manifestStream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
        try {
          $manifestBuilder = [System.Text.StringBuilder]::new()
          $characterBuffer = New-Object char[] 4096
          [long]$manifestCharacters = 0
          while (($charactersRead = $manifestReader.Read($characterBuffer, 0, $characterBuffer.Length)) -gt 0) {
            $manifestCharacters += [long]$charactersRead
            if ($manifestCharacters -gt 1MB) { throw 'expanded manifest exceeds limit' }
            $null = $manifestBuilder.Append($characterBuffer, 0, $charactersRead)
          }
          $artifactManifest = $manifestBuilder.ToString() | ConvertFrom-Json
        }
        finally { $manifestReader.Dispose(); $manifestStream.Dispose() }
        $artifactPackageType = [string](Get-A2OJsonProperty -Object $artifactManifest -Name 'packageType')
        $artifactPackageVersion = [string](Get-A2OJsonProperty -Object $artifactManifest -Name 'packageVersion')
        $artifactProduct = [string](Get-A2OJsonProperty -Object $artifactManifest -Name 'product')
        $artifactSchemaVersion = Get-A2OJsonProperty -Object $artifactManifest -Name 'schemaVersion'
        $artifactSignature = Get-A2OJsonProperty -Object $artifactManifest -Name 'signature'
        $artifactSignatureValue = [string](Get-A2OJsonProperty -Object $artifactSignature -Name 'value')
        if ($artifactPackageType -eq 'a2o.workspace-transfer') {
          if ($artifactPackageVersion -in @('1.0.0','2.0.0','3.0.0')) { $legacyArtifacts += $artifact }
          else { $invalidArtifacts += $artifact }
        } elseif ($artifactProduct -eq 'A2O Technical Baseline Manager') {
          if ($artifactSchemaVersion -in @(3,4) -and $artifactSignature -and $artifactSignatureValue -match '^[0-9a-f]{64}$') { $signedArtifacts += $artifact }
          elseif ($null -eq $artifactSchemaVersion -or $artifactSchemaVersion -in @(0,1,2)) { $legacyArtifacts += $artifact }
          else { $invalidArtifacts += $artifact }
        } else { $invalidArtifacts += $artifact }
      } catch { $invalidArtifacts += $artifact }
      finally { if ($artifactArchive) { $artifactArchive.Dispose() } }
    }
    if ($signedArtifacts.Count) { throw 'Signed recovery artifacts exist but their trusted signing key is missing. Import the separately escrowed key before initializing this workstation; do not create a new trust root.' }
    if ($invalidArtifacts.Count) { throw 'Recovery artifacts with unreadable or unsupported manifests exist. Isolate and inspect them before establishing a signing trust root.' }
    if ($legacyArtifacts.Count -and -not $AuthorizedLegacyTrustEstablishment) { throw 'Legacy unsigned recovery artifacts exist. Use the documented explicit legacy trust-establishment command only after recording an independent whole-archive SHA-256 value and planning one-time authenticated conversion.' }
    New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
    $random = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($random) } finally { $generator.Dispose() }
    $key = ([System.BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
    $null = Write-A2OProtectedSecretTextAtomic -Path $secretPath -Text $key -NoOverwrite
    Write-Output "Created workspace transfer signing material at $secretPath"
  } else {
    # Initialization is also the repair path for an ACL that became inherited or
    # drifted after a workstation restore. The key bytes never change here.
    Repair-A2OSecretFileAcl -Path $secretPath
  }
  $material = Get-A2OTransferSigningMaterial
  $runtimeSecretPath = Assert-A2OProjectPath -Candidate (Join-Path $secretDirectory 'workspace-transfer.runtime.env') -ProjectRoot $script:A2OProjectRoot
  $runtimeSecretText = (@(
    '# Generated by Initialize-A2OWorkspace.ps1. Do not commit or copy with workspace packages.'
    "WORKSPACE_TRANSFER_SIGNING_KEY_ID=`"$($material.KeyId)`""
    "WORKSPACE_TRANSFER_SIGNING_KEY=`"$($material.Key)`""
  ) -join [Environment]::NewLine) + [Environment]::NewLine
  $null = Write-A2OProtectedSecretTextAtomic -Path $runtimeSecretPath -Text $runtimeSecretText
  if (Test-Path -LiteralPath $legacyDevVarsPath -PathType Leaf) {
    $legacyAssignments = @(Get-Content -LiteralPath $legacyDevVarsPath | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') })
    if ($legacyAssignments.Count -ne 2 -or $legacyAssignments -notcontains "WORKSPACE_TRANSFER_SIGNING_KEY_ID=`"$($material.KeyId)`"" -or $legacyAssignments -notcontains "WORKSPACE_TRANSFER_SIGNING_KEY=`"$($material.Key)`"") {
      throw 'Legacy .dev.vars contains unmanaged or mismatched values. Remove or migrate it manually before continuing.'
    }
    [System.IO.File]::Delete($legacyDevVarsPath)
  }
  return $material
}

function Assert-A2OTransferSigningMaterial {
  $material = Get-A2OTransferSigningMaterial
  $runtimeSecretPath = Assert-A2OProjectPath -Candidate (Join-Path (Split-Path -Parent $material.Path) 'workspace-transfer.runtime.env') -ProjectRoot $script:A2OProjectRoot
  if (-not (Test-Path -LiteralPath $runtimeSecretPath -PathType Leaf)) { throw 'The local runtime secret file is missing. Run npm run local:init.' }
  $assignments = @{}
  foreach ($line in @(Get-Content -LiteralPath $runtimeSecretPath)) {
    if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
    $match = [regex]::Match($line, '^\s*(WORKSPACE_TRANSFER_SIGNING_KEY_ID|WORKSPACE_TRANSFER_SIGNING_KEY)\s*=\s*"([^"\r\n]*)"\s*$')
    if (-not $match.Success -or $assignments.ContainsKey($match.Groups[1].Value)) { throw 'The local runtime secret file contains an unexpected or duplicate assignment. Run npm run local:init.' }
    $assignments[$match.Groups[1].Value] = $match.Groups[2].Value
  }
  if ($assignments.Count -ne 2 -or $assignments['WORKSPACE_TRANSFER_SIGNING_KEY_ID'] -ne $material.KeyId -or $assignments['WORKSPACE_TRANSFER_SIGNING_KEY'] -ne $material.Key) {
    throw 'The local runtime secret file does not match the trusted workspace transfer signing material. Run npm run local:init.'
  }
  Assert-A2OSecretFileAcl -Path $material.Path
  Assert-A2OSecretFileAcl -Path $runtimeSecretPath
  return $material
}

function Get-A2OHmacSha256 {
  param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][byte[]]$KeyBytes
  )
  $algorithm = [System.Security.Cryptography.HMACSHA256]::new($KeyBytes)
  try { return ([System.BitConverter]::ToString($algorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Test-A2OConstantTimeHexEqual {
  param([string]$Left, [string]$Right)
  if ($Left -notmatch '^[0-9a-f]{64}$' -or $Right -notmatch '^[0-9a-f]{64}$') { return $false }
  $difference = 0
  for ($index = 0; $index -lt $Left.Length; $index++) { $difference = $difference -bor ([int][char]$Left[$index] -bxor [int][char]$Right[$index]) }
  return $difference -eq 0
}

function Get-A2OBackupSignaturePayload {
  param([Parameter(Mandatory=$true)]$Manifest)
  $schemaVersion = [int](Get-A2OJsonProperty -Object $Manifest -Name 'schemaVersion')
  $files = @((Get-A2OJsonProperty -Object $Manifest -Name 'files') | ForEach-Object {
    [ordered]@{
      path = [string](Get-A2OJsonProperty -Object $_ -Name 'path')
      bytes = [long](Get-A2OJsonProperty -Object $_ -Name 'bytes')
      sha256 = [string](Get-A2OJsonProperty -Object $_ -Name 'sha256')
    }
  })
  $signature = Get-A2OJsonProperty -Object $Manifest -Name 'signature'

  if ($schemaVersion -eq 3) {
    # Schema 3 is frozen. Preserve its original field order and UTC round-trip
    # timestamp normalization so previously issued signed backups remain valid.
    $createdAtValue = Get-A2OJsonProperty -Object $Manifest -Name 'createdAt'
    try {
      if ($createdAtValue -is [datetime]) {
        $createdAt = ([DateTimeOffset]$createdAtValue.ToUniversalTime()).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
      } else {
        $createdAt = [DateTimeOffset]::ParseExact([string]$createdAtValue, 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
      }
    } catch { throw 'The schema-3 backup manifest contains an invalid creation timestamp.' }
    $payload = [ordered]@{
      domain = 'a2o.local-backup.manifest.v1'
      schemaVersion = $schemaVersion
      product = [string](Get-A2OJsonProperty -Object $Manifest -Name 'product')
      createdAt = $createdAt
      computer = [string](Get-A2OJsonProperty -Object $Manifest -Name 'computer')
      databaseExport = [string](Get-A2OJsonProperty -Object $Manifest -Name 'databaseExport')
      stateDirectory = [string](Get-A2OJsonProperty -Object $Manifest -Name 'stateDirectory')
      gitCommit = [string](Get-A2OJsonProperty -Object $Manifest -Name 'gitCommit')
      gitTree = [string](Get-A2OJsonProperty -Object $Manifest -Name 'gitTree')
      files = $files
      signatureAlgorithm = [string](Get-A2OJsonProperty -Object $signature -Name 'algorithm')
      signatureKeyId = [string](Get-A2OJsonProperty -Object $signature -Name 'keyId')
    }
    return ($payload | ConvertTo-Json -Depth 8 -Compress)
  }

  if ($schemaVersion -ne 4) { throw "No canonical backup signature payload is defined for schema $schemaVersion." }
  $activeRelease = Get-A2OJsonProperty -Object $Manifest -Name 'activeRelease'
  $backupProducer = Get-A2OJsonProperty -Object $Manifest -Name 'backupProducer'
  $payload = [ordered]@{
    domain = 'a2o.local-backup.manifest.v2'
    schemaVersion = $schemaVersion
    product = [string](Get-A2OJsonProperty -Object $Manifest -Name 'product')
    createdAtUnixMs = [long](Get-A2OJsonProperty -Object $Manifest -Name 'createdAtUnixMs')
    computer = [string](Get-A2OJsonProperty -Object $Manifest -Name 'computer')
    databaseExport = [string](Get-A2OJsonProperty -Object $Manifest -Name 'databaseExport')
    stateDirectory = [string](Get-A2OJsonProperty -Object $Manifest -Name 'stateDirectory')
    activeRelease = [ordered]@{
      provenanceMode = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'provenanceMode')
      gitCommit = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'gitCommit')
      gitTree = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'gitTree')
      appliedMigrationsSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'appliedMigrationsSha256')
      migrationFilesSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'migrationFilesSha256')
      runtimeConfigSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'runtimeConfigSha256')
      buildManifestSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'buildManifestSha256')
    }
    backupProducer = [ordered]@{
      gitCommit = [string](Get-A2OJsonProperty -Object $backupProducer -Name 'gitCommit')
      gitTree = [string](Get-A2OJsonProperty -Object $backupProducer -Name 'gitTree')
      commonScriptSha256 = [string](Get-A2OJsonProperty -Object $backupProducer -Name 'commonScriptSha256')
      backupScriptSha256 = [string](Get-A2OJsonProperty -Object $backupProducer -Name 'backupScriptSha256')
    }
    files = $files
    signatureAlgorithm = [string](Get-A2OJsonProperty -Object $signature -Name 'algorithm')
    signatureKeyId = [string](Get-A2OJsonProperty -Object $signature -Name 'keyId')
  }
  return ($payload | ConvertTo-Json -Depth 8 -Compress)
}

function Get-A2OAppliedMigrationsSha256 {
  param([string]$PersistTo = '.wrangler/state')
  $migrationJson = (& npx --no-install wrangler d1 execute DB --config wrangler.local-runtime.jsonc --local --persist-to $PersistTo --command 'SELECT id, name FROM d1_migrations ORDER BY id;' --json) | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'The applied migration provenance could not be read.' }
  try { $migrationResult = $migrationJson | ConvertFrom-Json }
  catch { throw 'The applied migration provenance was not valid JSON.' }
  $entries = @($migrationResult[0].results | ForEach-Object {
    [ordered]@{ id = [long]$_.id; name = [string]$_.name }
  })
  if (-not $entries.Count) { throw 'The active workspace does not report any applied migrations.' }
  return (Get-A2OTextSha256 -Text ([ordered]@{ schemaVersion = 1; migrations = $entries } | ConvertTo-Json -Depth 5 -Compress))
}

function Get-A2OMigrationFilesSha256 {
  $migrationRoot = Join-Path $script:A2OProjectRoot 'drizzle'
  $entries = @(Get-ChildItem -LiteralPath $migrationRoot -Filter '*.sql' -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; bytes = [long]$_.Length; sha256 = Get-A2OFileSha256 -Path $_.FullName }
  })
  if (-not $entries.Count) { throw 'The checked-out release does not contain migration files.' }
  return (Get-A2OTextSha256 -Text ([ordered]@{ schemaVersion = 1; files = $entries } | ConvertTo-Json -Depth 5 -Compress))
}

function Get-A2OActiveReleaseSignaturePayload {
  param([Parameter(Mandatory=$true)]$Record)
  $activeRelease = Get-A2OJsonProperty -Object $Record -Name 'activeRelease'
  $signature = Get-A2OJsonProperty -Object $Record -Name 'signature'
  $payload = [ordered]@{
    domain = 'a2o.local-active-release.v1'
    schemaVersion = [int](Get-A2OJsonProperty -Object $Record -Name 'schemaVersion')
    product = [string](Get-A2OJsonProperty -Object $Record -Name 'product')
    recordedAtUnixMs = [long](Get-A2OJsonProperty -Object $Record -Name 'recordedAtUnixMs')
    activeRelease = [ordered]@{
      provenanceMode = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'provenanceMode')
      gitCommit = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'gitCommit')
      gitTree = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'gitTree')
      appliedMigrationsSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'appliedMigrationsSha256')
      migrationFilesSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'migrationFilesSha256')
      runtimeConfigSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'runtimeConfigSha256')
      buildManifestSha256 = [string](Get-A2OJsonProperty -Object $activeRelease -Name 'buildManifestSha256')
    }
    signatureAlgorithm = [string](Get-A2OJsonProperty -Object $signature -Name 'algorithm')
    signatureKeyId = [string](Get-A2OJsonProperty -Object $signature -Name 'keyId')
  }
  return ($payload | ConvertTo-Json -Depth 7 -Compress)
}

function ConvertTo-A2OActiveReleaseRecord {
  param([Parameter(Mandatory=$true)]$ActiveRelease)
  return [ordered]@{
    provenanceMode = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'provenanceMode')
    gitCommit = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'gitCommit')
    gitTree = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'gitTree')
    appliedMigrationsSha256 = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'appliedMigrationsSha256')
    migrationFilesSha256 = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'migrationFilesSha256')
    runtimeConfigSha256 = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'runtimeConfigSha256')
    buildManifestSha256 = [string](Get-A2OJsonProperty -Object $ActiveRelease -Name 'buildManifestSha256')
  }
}

function Assert-A2OActiveReleaseFields {
  param([Parameter(Mandatory=$true)]$ActiveRelease)
  $normalized = ConvertTo-A2OActiveReleaseRecord -ActiveRelease $ActiveRelease
  if ($normalized.provenanceMode -notin @('verified-release','signed-schema3-compatibility','recorded-hash-legacy-compatibility')) {
    throw 'The active-release provenance mode is invalid.'
  }
  if ($normalized.gitCommit -notmatch '^[0-9a-f]{40,64}$' -or $normalized.gitTree -notmatch '^[0-9a-f]{40,64}$') {
    throw 'The active-release provenance contains an invalid Git object identity.'
  }
  foreach ($field in @('appliedMigrationsSha256','migrationFilesSha256','runtimeConfigSha256','buildManifestSha256')) {
    if ([string]$normalized[$field] -notmatch '^[0-9a-f]{64}$') { throw "The active-release provenance contains an invalid $field value." }
  }
  return $normalized
}

function Write-A2OActiveReleaseProvenance {
  param(
    [Parameter(Mandatory=$true)]$ActiveRelease,
    [long]$RecordedAtUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  )
  if ([System.Convert]::ToString($RecordedAtUnixMs, [System.Globalization.CultureInfo]::InvariantCulture) -notmatch '^[0-9]{13,16}$') { throw 'The active-release provenance timestamp is invalid.' }
  $normalized = Assert-A2OActiveReleaseFields -ActiveRelease $ActiveRelease
  $signingMaterial = Assert-A2OTransferSigningMaterial
  $record = [ordered]@{
    schemaVersion = 1
    product = 'A2O Technical Baseline Manager active release provenance'
    recordedAtUnixMs = $RecordedAtUnixMs
    activeRelease = $normalized
    signature = [ordered]@{ algorithm = 'HMAC-SHA-256'; keyId = $signingMaterial.KeyId; value = '' }
  }
  $record.signature.value = Get-A2OHmacSha256 -Text (Get-A2OActiveReleaseSignaturePayload -Record $record) -KeyBytes $signingMaterial.KeyBytes
  $provenancePath = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.wrangler\active-release-provenance.json') -ProjectRoot $script:A2OProjectRoot
  $json = ($record | ConvertTo-Json -Depth 8) + [Environment]::NewLine
  $null = Write-A2OTextFileAtomic -Path $provenancePath -Text $json
  return [pscustomobject]$normalized
}

function Set-A2OCurrentActiveReleaseProvenance {
  $commit = [string]((& git rev-parse HEAD 2>$null) | Select-Object -First 1)
  $tree = [string]((& git rev-parse 'HEAD^{tree}' 2>$null) | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { throw 'The active Git release identity could not be read.' }
  $activeRelease = [ordered]@{
    provenanceMode = 'verified-release'
    gitCommit = $commit.Trim()
    gitTree = $tree.Trim()
    appliedMigrationsSha256 = Get-A2OAppliedMigrationsSha256
    migrationFilesSha256 = Get-A2OMigrationFilesSha256
    runtimeConfigSha256 = Get-A2OFileSha256 -Path (Join-Path $script:A2OProjectRoot 'wrangler.local-runtime.jsonc')
    buildManifestSha256 = Get-A2OFileSha256 -Path (Join-Path $script:A2OProjectRoot 'dist\a2o-build-manifest.json')
  }
  $written = Write-A2OActiveReleaseProvenance -ActiveRelease $activeRelease
  Write-Output "Active release provenance recorded: $($written.gitCommit)"
  return $written
}

function New-A2OCompatibilityActiveReleaseProvenance {
  param(
    [Parameter(Mandatory=$true)][ValidateSet('signed-schema3-compatibility','recorded-hash-legacy-compatibility')][string]$ProvenanceMode,
    [Parameter(Mandatory=$true)][string]$GitCommit,
    [Parameter(Mandatory=$true)][string]$GitTree,
    [Parameter(Mandatory=$true)][string]$ArchiveSha256
  )
  if ($GitCommit -notmatch '^[0-9a-f]{40,64}$' -or $GitTree -notmatch '^[0-9a-f]{40,64}$' -or $ArchiveSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'Compatibility provenance requires valid Git commit, Git tree, and archive SHA-256 identities.'
  }
  $identity = "$ProvenanceMode|$GitCommit|$GitTree|$ArchiveSha256"
  return [ordered]@{
    provenanceMode = $ProvenanceMode
    gitCommit = $GitCommit
    gitTree = $GitTree
    appliedMigrationsSha256 = Get-A2OAppliedMigrationsSha256
    migrationFilesSha256 = Get-A2OTextSha256 -Text "a2o.compatibility.migration-source.v1|$identity"
    runtimeConfigSha256 = Get-A2OTextSha256 -Text "a2o.compatibility.runtime-config.v1|$identity"
    buildManifestSha256 = Get-A2OTextSha256 -Text "a2o.compatibility.build-identity.v1|$identity"
  }
}

function Get-A2OActiveReleaseProvenance {
  param([switch]$VerifyCurrentState)
  $provenancePath = Assert-A2OProjectPath -Candidate (Join-Path $script:A2OProjectRoot '.wrangler\active-release-provenance.json') -ProjectRoot $script:A2OProjectRoot
  if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
    throw 'The signed active-release provenance record is missing. Verify the active release before pulling an update; do not label current state with a newly pulled commit.'
  }
  try { $record = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json }
  catch { throw 'The active-release provenance record is not valid JSON.' }
  $recordedAtText = [System.Convert]::ToString((Get-A2OJsonProperty -Object $record -Name 'recordedAtUnixMs'), [System.Globalization.CultureInfo]::InvariantCulture)
  if ($recordedAtText -notmatch '^[0-9]{13,16}$') { throw 'The active-release provenance record contains an invalid timestamp.' }
  $signingMaterial = Assert-A2OTransferSigningMaterial
  $signature = Get-A2OJsonProperty -Object $record -Name 'signature'
  $value = [string](Get-A2OJsonProperty -Object $signature -Name 'value')
  if ((Get-A2OJsonProperty -Object $record -Name 'schemaVersion') -ne 1 -or
      [string](Get-A2OJsonProperty -Object $record -Name 'product') -ne 'A2O Technical Baseline Manager active release provenance' -or
      [string](Get-A2OJsonProperty -Object $signature -Name 'algorithm') -ne 'HMAC-SHA-256' -or
      [string](Get-A2OJsonProperty -Object $signature -Name 'keyId') -ne $signingMaterial.KeyId -or
      $value -notmatch '^[0-9a-f]{64}$') {
    throw 'The active-release provenance record is missing trusted signature metadata.'
  }
  $expected = Get-A2OHmacSha256 -Text (Get-A2OActiveReleaseSignaturePayload -Record $record) -KeyBytes $signingMaterial.KeyBytes
  if (-not (Test-A2OConstantTimeHexEqual -Left $value -Right $expected)) { throw 'The active-release provenance record failed authenticity validation.' }
  $normalized = Assert-A2OActiveReleaseFields -ActiveRelease (Get-A2OJsonProperty -Object $record -Name 'activeRelease')
  if ($VerifyCurrentState) {
    $currentMigrationHash = Get-A2OAppliedMigrationsSha256
    if ($currentMigrationHash -ne $normalized.appliedMigrationsSha256) { throw 'The workspace migration state no longer matches the signed active-release provenance record.' }
  }
  return [pscustomobject]$normalized
}

function Assert-A2OBuildManifest {
  $manifestPath = Join-Path $script:A2OProjectRoot 'dist\a2o-build-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The local build provenance manifest is missing. Run npm run local:verify.'
  }
  try { $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json }
  catch { throw 'The local build provenance manifest is not valid JSON.' }
  if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'A2O Technical Baseline Manager' -or $manifest.sourceState -ne 'clean') {
    throw 'The local build was not produced from a clean, supported A2O source tree.'
  }

  Assert-A2OCleanSource
  $currentCommit = (& git rev-parse HEAD 2>$null).Trim()
  $currentTree = (& git rev-parse 'HEAD^{tree}' 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $manifest.gitCommit -ne $currentCommit -or $manifest.gitTree -ne $currentTree -or $manifest.buildSha -ne $currentCommit) {
    throw 'The built runtime does not match the checked-out A2O release commit. Rebuild and verify this exact source.'
  }

  $distRoot = [System.IO.Path]::GetFullPath((Join-Path $script:A2OProjectRoot 'dist'))
  $allowedRoots = @()
  $allowedRoots += [System.IO.Path]::GetFullPath((Join-Path $distRoot 'server')).TrimEnd('\') + '\'
  $allowedRoots += [System.IO.Path]::GetFullPath((Join-Path $distRoot 'client')).TrimEnd('\') + '\'
  $declared = @{}
  foreach ($entry in @($manifest.files)) {
    if (-not $entry.path -or $declared.ContainsKey([string]$entry.path)) { throw 'The build manifest contains a missing or duplicate runtime path.' }
    $absolute = [System.IO.Path]::GetFullPath((Join-Path $script:A2OProjectRoot ([string]$entry.path)))
    if (-not ($allowedRoots | Where-Object { $absolute.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })) {
      throw "Unsafe build manifest path: $($entry.path)"
    }
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "A built runtime file is missing: $($entry.path)" }
    $file = Get-Item -LiteralPath $absolute
    $hash = Get-A2OFileSha256 -Path $absolute
    if ([long]$entry.bytes -ne $file.Length -or [string]$entry.sha256 -ne $hash) { throw "A built runtime file failed integrity validation: $($entry.path)" }
    $declared[[string]$entry.path] = $true
  }
  if (-not $declared.Count) { throw 'The build manifest does not declare any runtime files.' }
  $actual = @(Get-ChildItem -LiteralPath (Join-Path $distRoot 'server'),(Join-Path $distRoot 'client') -File -Recurse | ForEach-Object {
    Get-A2ORelativePath -BasePath $script:A2OProjectRoot -ChildPath $_.FullName
  })
  $unexpected = @($actual | Where-Object { -not $declared.ContainsKey($_) })
  if ($actual.Count -ne $declared.Count -or $unexpected.Count) { throw "The built runtime contains files outside its integrity manifest: $($unexpected -join ', ')" }
  Write-Output "Build provenance verified: $currentCommit - $($declared.Count) runtime files."
}

function Assert-A2OProjectPath {
  param(
    [Parameter(Mandatory=$true)][string]$Candidate,
    [Parameter(Mandatory=$true)][string]$ProjectRoot
  )

  $rootWithSeparator = $ProjectRoot.TrimEnd('\') + '\'
  $absolute = [System.IO.Path]::GetFullPath($Candidate)
  if (-not $absolute.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path must remain inside the project: $absolute"
  }
  return $absolute
}
