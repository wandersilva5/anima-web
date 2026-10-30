#Requires -Version 5.1
<#
.SYNOPSIS
    Envia a galeria (frontend compilado + backend PHP) para a Hostinger por FTP/FTPS.

.DESCRIPTION
    Mapeamento usado:
      server/public/*      ->  <remotePublic>/            (webroot do subdominio)
      server/app/*         ->  <remotePrivate>/app/*
      server/db/*          ->  <remotePrivate>/db/*
      server/.env          ->  <remotePrivate>/.env       (somente com -UploadEnv)

    Nunca envia nem apaga a pasta media/ (dados) nem storage/ (logs).
    So sobe arquivos cujo SHA-256 mudou desde o ultimo deploy (estado em tools/.deploy-state.json).

.PARAMETER DryRun
    Lista o que seria enviado, sem conectar.

.PARAMETER UploadEnv
    Inclui o server/.env no envio (por padrao ele nunca e tocado).

.PARAMETER Force
    Reenvia tudo, ignorando o estado local.

.PARAMETER Build
    Roda `npm run build` em app/ antes de enviar.

.EXAMPLE
    .\tools\deploy.ps1 -Build
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$UploadEnv,
    [switch]$Force,
    [switch]$Build,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# $PSScriptRoot pode vir vazio (ex.: powershell -File em algumas chamadas): resolver com fallback.
$scriptRoot = $PSScriptRoot
if (-not $scriptRoot -and $MyInvocation.MyCommand.Path) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $scriptRoot) { $scriptRoot = (Get-Location).Path }

if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptRoot 'deploy.config.json' }

$workspace = Split-Path -Parent $scriptRoot
$publicRoot = Join-Path $workspace 'server\public'
$appRoot = Join-Path $workspace 'server\app'
$dbRoot = Join-Path $workspace 'server\db'
$stateFile = Join-Path $scriptRoot '.deploy-state.json'

# ------------------------------------------------------------------ config

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host "Arquivo de configuracao nao encontrado: $ConfigPath" -ForegroundColor Yellow
    Write-Host 'Copie tools/deploy.config.example.json para tools/deploy.config.json e preencha.' -ForegroundColor Yellow
    exit 1
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

foreach ($required in 'host', 'user', 'remotePublic', 'remotePrivate') {
    if (-not $config.$required) {
        Write-Host "Campo obrigatorio ausente no $ConfigPath : $required" -ForegroundColor Red
        exit 1
    }
}

# Aceita "ftp://host", "host/", "host/pasta" ou IP: o que vale e so o nome.
$ftpHost = ($config.host -replace '^[a-zA-Z]+://', '').Split('/')[0].Trim()
$config | Add-Member -NotePropertyName host -NotePropertyValue $ftpHost -Force
if ($ftpHost -match '^\d{1,3}(\.\d{1,3}){3}$') {
    Write-Host "Aviso: $ftpHost e um IP. Com FTPS o certificado e emitido para o nome; se falhar, use ftp.seudominio.com." -ForegroundColor Yellow
}

if (-not $config.port) { $config | Add-Member -NotePropertyName port -NotePropertyValue 21 -Force }
if ($null -eq $config.tls) { $config | Add-Member -NotePropertyName tls -NotePropertyValue $true -Force }

$password = $config.password
if (-not $password) {
    $secure = Read-Host -AsSecureString "Senha FTP de $($config.user)"
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$config | Add-Member -NotePropertyName password -NotePropertyValue $password -Force

# '' = raiz do docroot (quando o FTP ja esta preso a pasta do site)
$remotePublic = if ($config.remotePublic.Trim('/') -eq '') { '' } else { '/' + $config.remotePublic.Trim('/') }
$remotePrivate = if ($config.remotePrivate.Trim('/') -eq '') { '' } else { '/' + $config.remotePrivate.Trim('/') }

# ------------------------------------------------------------------- build

if ($Build) {
    Write-Host 'Compilando o frontend (app/)…' -ForegroundColor Cyan
    Push-Location (Join-Path $workspace 'app')
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou.' }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $publicRoot 'index.html'))) {
    Write-Host 'server/public/index.html nao existe. Rode com -Build ou compile o app antes.' -ForegroundColor Yellow
}

# ------------------------------------------------------------- lista de envio

function Get-FileList {
    param([string]$root, [string]$remoteBase, [string[]]$excludeTop)

    if (-not (Test-Path -LiteralPath $root)) { return @() }

    Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
        $top = ($relative -split '/')[0]
        if ($excludeTop -contains $top) { return }
        if ($_.Name -like '.deploy-state*') { return }
        [pscustomobject]@{
            Local  = $_.FullName
            Remote = "$remoteBase/$relative"
        }
    }
}

$map = @()
$map += Get-FileList -root $publicRoot -remoteBase $remotePublic -excludeTop @('media', '.well-known')
$map += Get-FileList -root $appRoot -remoteBase "$remotePrivate/app" -excludeTop @()
$map += Get-FileList -root $dbRoot -remoteBase "$remotePrivate/db" -excludeTop @()

$envFile = Join-Path $workspace 'server\.env'
if ($UploadEnv -and (Test-Path -LiteralPath $envFile)) {
    $map += [pscustomobject]@{ Local = $envFile; Remote = "$remotePrivate/.env" }
}

# --------------------------------------------------------------- estado local

$state = @{}
if (-not $Force -and (Test-Path -LiteralPath $stateFile)) {
    try {
        $loaded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        foreach ($property in $loaded.PSObject.Properties) { $state[$property.Name] = $property.Value }
    } catch {
        Write-Host 'Estado de deploy anterior ilegivel; reenviando tudo.' -ForegroundColor Yellow
        $state = @{}
    }
}

$todo = New-Object System.Collections.Generic.List[object]
$totalBytes = 0

foreach ($item in $map) {
    $hash = (Get-FileHash -LiteralPath $item.Local -Algorithm SHA256).Hash
    $item | Add-Member -NotePropertyName Hash -NotePropertyValue $hash -Force
    if (-not $Force -and $state[$item.Remote] -eq $hash) { continue }
    $todo.Add($item) | Out-Null
    $totalBytes += (Get-Item -LiteralPath $item.Local).Length
}

Write-Host ("{0} arquivo(s) local(is); {1} para enviar ({2:N1} MB)." -f $map.Count, $todo.Count, ($totalBytes / 1MB)) -ForegroundColor Cyan

if ($DryRun) {
    foreach ($item in $todo) { Write-Host "  + $($item.Remote)" }
    Write-Host 'Dry-run: nada foi enviado.' -ForegroundColor Yellow
    exit 0
}

if ($todo.Count -eq 0) {
    Write-Host 'Tudo sincronizado — nada a enviar.' -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------- FTP

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$credentials = New-Object System.Net.NetworkCredential($config.user, $config.password)
$knownDirs = New-Object System.Collections.Generic.HashSet[string]

if ($config.tls) {
    # O servidor FTP da Hostinger apresenta o certificado *.hstgr.io, que nunca casa
    # com o nome do nosso dominio. Aceita esse caso (nome diferente), mas nao aceita
    # cadeia invalida/expirada.
    [Net.ServicePointManager]::ServerCertificateValidationCallback = {
        param($sender, $cert, $chain, $errors)
        $mismatch = [System.Net.Security.SslPolicyErrors]::RemoteCertificateNameMismatch
        if ($errors -eq [System.Net.Security.SslPolicyErrors]::None) { return $true }
        if ($errors -eq $mismatch) { return $true }
        return $false
    }
}

function New-FtpRequest {
    param([string]$Path, [string]$Method)

    $uri = [Uri]::new(('ftp://{0}:{1}{2}' -f $config.host, $config.port, $Path))
    $request = [System.Net.FtpWebRequest]::Create($uri)
    $request.Method = $Method
    $request.Credentials = $credentials
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.EnableSsl = [bool]$config.tls
    $request.KeepAlive = $false
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 180000
    return $request
}

function Ensure-RemoteDir {
    param([string]$Directory)

    $normalized = $Directory.Trim('/')
    if ($normalized -eq '') { return }

    $current = ''
    foreach ($part in $normalized.Split('/')) {
        $current += "/$part"
        if ($knownDirs.Contains($current)) { continue }
        try {
            $request = New-FtpRequest -Path $current -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
            $response = $request.GetResponse()
            $response.Close()
        } catch [System.Net.WebException] {
            # 550: diretorio ja existe
            $status = $_.Exception.Response.StatusCode
            if ($status -ne [System.Net.FtpStatusCode]::ActionNotTakenFileUnavailable) {
                Write-Verbose "MKD $current -> $status"
            }
        }
        [void]$knownDirs.Add($current)
    }
}

function Send-FtpFile {
    param([string]$Local, [string]$Remote)

    $bytes = [System.IO.File]::ReadAllBytes($Local)
    $parent = ($Remote -replace '/[^/]+$', '')
    Ensure-RemoteDir -Directory $parent

    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $request = New-FtpRequest -Path $Remote -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile)
            $request.ContentLength = $bytes.Length
            $stream = $request.GetRequestStream()
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Close()
            $response = $request.GetResponse()
            $response.Close()
            return
        } catch {
            $lastError = $_
            Start-Sleep -Seconds $attempt
        }
    }
    throw $lastError
}

$index = 0
$failed = 0

# ---------------------------------------------------- conferencia da conexao

Write-Host 'Conectando ao FTP...' -ForegroundColor Cyan
$rootNames = @()
try {
    $probe = New-FtpRequest -Path '/' -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails)
    $response = $probe.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $listing = $reader.ReadToEnd()
    $reader.Close()
    $response.Close()
    $rootNames = @($listing -split "`r?`n" | Where-Object { $_ -match '^d' } | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ })
} catch {
    Write-Host "Nao consegui entrar no FTP: $($config.user) @ $($config.host)" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Login recusado (530) = usuario ou senha do FTP errados; redefina a senha no hPanel.' -ForegroundColor Yellow
    exit 1
}

if ($rootNames.Count -gt 0) {
    Write-Host ('Pastas na raiz da conta FTP: {0}' -f ($rootNames -join ', ')) -ForegroundColor DarkGray
}

foreach ($remoteBase in @($remotePublic)) {
    $first = $remoteBase.Trim('/').Split('/')[0]
    if ($first -ne '' -and $rootNames.Count -gt 0 -and -not ($rootNames -contains $first)) {
        Write-Host "A pasta '$first' nao existe na raiz desta conta FTP." -ForegroundColor Red
        Write-Host "  Ajuste remotePublic no deploy.config.json. Existentes: $($rootNames -join ', ')" -ForegroundColor Yellow
        exit 1
    }
}

foreach ($item in $todo) {
    $index++
    $label = '{0,4}/{1}  {2}' -f $index, $todo.Count, $item.Remote
    try {
        Write-Host $label -NoNewline
        Send-FtpFile -Local $item.Local -Remote $item.Remote
        $state[$item.Remote] = $item.Hash
        Write-Host "  ok" -ForegroundColor Green
    } catch {
        $failed++
        Write-Host "  FALHOU: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# --------------------------------------------------------------- pos-deploy

$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ''
if ($failed -gt 0) {
    Write-Host "$failed arquivo(s) falharam. Rode de novo para tentar apenas o que falta." -ForegroundColor Red
} else {
    Write-Host 'Envio concluido.' -ForegroundColor Green
}

Write-Host @"

Lembretes pos-deploy em https://femipro.trustchoicereviews.com :
  1. Codigo privado em '/anima' (dentro do docroot, bloqueado pelo .htaccess) ou fora
     do webroot quando a conta FTP tem acesso a pasta acima de public_html.
  2. Crie $remotePrivate/.env a partir de server/.env.example (rode com -UploadEnv).
     Caminhos ABSOLUTOS no servidor (o FTP ve outra raiz):
       STORAGE_DIR=/home/USUARIO/domains/femipro.trustchoicereviews.com/public_html/anima/storage
       MEDIA_DIR=/home/USUARIO/domains/femipro.trustchoicereviews.com/public_html/media
  3. Primeira instalacao (SSH):
       php /home/USUARIO/domains/femipro.trustchoicereviews.com/public_html/anima/app/cli/migrate.php
  4. Confirme que $remotePublic/media existe e aceita escrita (0755).
  5. Gere o SYNC_TOKEN em Admin > Painel e cole no painel local.
"@
