[CmdletBinding()]
param(
  [switch]$Json
)

# Generates the central relay token and its SHA-256 fingerprint.
# This script only writes to stdout; it never writes .env, Git, or a file.

$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $bytes = New-Object byte[] 32
  $random.GetBytes($bytes)
}
finally {
  $random.Dispose()
}

$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token))
}
finally {
  $sha.Dispose()
}
$hash = ([BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()

$result = [pscustomobject]@{
  token = $token
  sha256 = $hash
  tokenLength = $token.Length
  hashLength = $hash.Length
}

if ($Json) {
  $result | ConvertTo-Json -Compress
  exit 0
}

Write-Output "TOKEN_RAW_HOST_ONLY=$token"
Write-Output "RELAY_AGENT_TOKEN_SHA256_RENDER_ONLY=$hash"
Write-Output "tokenLength=$($token.Length) (base64url, 32 bytes de entropia)"
Write-Output "hashLength=$($hash.Length) (SHA-256 hexadecimal)"
Write-Output ""
Write-Output "Host central: `$env:RELAY_AGENT_TOKEN = `"$token`""
Write-Output "Render: RELAY_AGENT_TOKEN_SHA256 = $hash"
Write-Output "Não cole o TOKEN_RAW_HOST_ONLY no Render, Git ou PC remoto."
