# Publica o backend PHP no InfinityFree
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy_backend.ps1

param(
  [string]$LocalRoot = (Join-Path $PSScriptRoot 'server\app'),
  [string]$RemoteRoot = '/wsengenhariadigital.com.br/htdocs/anima/app',
  [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ------------------------------------------------------------------- config
$candidates = @()
if ($ConfigPath) { $candidates += $ConfigPath }
$candidates += (Join-Path $PSScriptRoot 'deploy.config.json')
$candidates += 'F:\codigos\015\tools\deploy.config.json'

$configFile = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $configFile) {
  throw "deploy.config.json nao encontrado. Crie um com { host, port, tls, user, password, remoteRoot }."
}
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json

if (-not $RemoteRoot) {
  $RemoteRoot = if ($config.remoteRoot) { $config.remoteRoot } else { '/wsengenhariadigital.com.br/htdocs/anima/app' }
}

# -------------------------------------------------------------------- ftp
$host_ = ($config.host -replace '^[a-zA-Z]+://', '').Split('/')[0].Trim()
$cred = New-Object System.Net.NetworkCredential($config.user, $config.password)
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

function New-Req([string]$Path, [string]$Method) {
  $uri = [Uri]::new(('ftp://{0}:{1}{2}' -f $host_, ($config.port + 0), $Path))
  $r = [System.Net.FtpWebRequest]::Create($uri)
  $r.Method = $Method
  $r.Credentials = $cred
  $r.UseBinary = $true
  $r.UsePassive = $true
  $r.EnableSsl = [bool]$config.tls
  $r.KeepAlive = $false
  $r.Timeout = 30000
  $r.ReadWriteTimeout = 120000
  return $r
}

function Ensure-Dir([string]$RemoteDir) {
  $acc = ''
  foreach ($p in $RemoteDir.Trim('/').Split('/')) {
    $acc += '/' + $p
    try {
      $req = New-Req -Path $acc -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
      $req.GetResponse().Close()
    } catch {
      # diretorio ja existe
    }
  }
}

if (-not (Test-Path -LiteralPath $LocalRoot)) {
  throw "Pasta local nao encontrada: $LocalRoot"
}

# Garante que o diretório raiz remoto existe
Ensure-Dir $RemoteRoot

$files = Get-ChildItem -Recurse -File -LiteralPath $LocalRoot
$total = $files.Count
Write-Output "Enviando $total arquivo(s) para $RemoteRoot"
$i = 0

foreach ($file in $files) {
  $i++
  $rel = $file.FullName.Substring($LocalRoot.Length).TrimStart('\', '/') -replace '\\', '/'
  $remoteFile = "$RemoteRoot/$rel"
  $remoteDir = $remoteFile -replace '/[^/]+$', ''
  if ($remoteDir -ne $RemoteRoot) { Ensure-Dir $remoteDir }

  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $req = New-Req -Path $remoteFile -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile)
  $req.ContentLength = $bytes.Length
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  $req.GetResponse().Close()
  Write-Output ('{0}/{1} {2}' -f $i, $total, $rel)
}

Write-Output 'Concluido.'