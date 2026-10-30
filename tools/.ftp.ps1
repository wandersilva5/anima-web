param(
    [Parameter(Mandatory = $true)][string]$Action,
    [string]$Local,
    [string]$Remote
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy.config.json') -Raw | ConvertFrom-Json
$host_ = ($config.host -replace '^[a-zA-Z]+://', '').Split('/')[0].Trim()
$cred = New-Object System.Net.NetworkCredential($config.user, $config.password)

[Net.ServicePointManager]::ServerCertificateValidationCallback = {
    param($sender, $cert, $chain, $errors)
    if ($errors -eq [System.Net.Security.SslPolicyErrors]::None) { return $true }
    if ($errors -eq [System.Net.Security.SslPolicyErrors]::RemoteCertificateNameMismatch) { return $true }
    return $false
}

function New-Req([string]$Path, [string]$Method) {
    $uri = [Uri]::new(('ftp://{0}:{1}{2}' -f $host_, ($config.port + 0), $Path))
    $request = [System.Net.FtpWebRequest]::Create($uri)
    $request.Method = $Method
    $request.Credentials = $cred
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.EnableSsl = [bool]$config.tls
    $request.KeepAlive = $false
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 60000
    return $request
}

switch ($Action) {
    'put' {
        if (-not $Remote) { $Remote = '/' + (Split-Path -Leaf $Local) }
        $bytes = [System.IO.File]::ReadAllBytes($Local)
        $request = New-Req -Path $Remote -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile)
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $request.GetResponse().Close()
        Write-Output "enviado: $Remote"
    }
    'del' {
        $request = New-Req -Path $Remote -Method ([System.Net.WebRequestMethods+Ftp]::DeleteFile)
        $request.GetResponse().Close()
        Write-Output "apagado: $Remote"
    }
    'ls' {
        $path = if ($Remote) { $Remote } else { '/' }
        $request = New-Req -Path $path -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails)
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $text = $reader.ReadToEnd()
        $reader.Close()
        $response.Close()
        Write-Output "--- $path ---"
        $text
    }
    default { throw "Acao desconhecida: $Action" }
}
