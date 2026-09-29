<#
  Mini servidor local para abrir o Black Hole no navegador, sem instalar nada.

  Os módulos JavaScript (ES Modules) não carregam quando o index.html é aberto
  direto do disco (file://). Este script serve a pasta do projeto em
  http://localhost:8000 e abre o navegador padrão.

  Uso: dê dois cliques em iniciar.bat
   ou: powershell -ExecutionPolicy Bypass -File tools\servidor.ps1 [-Port 8000] [-NoBrowser]

  Compatível com Windows PowerShell 5.1 e PowerShell 7+.
#>
param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

function Send-Response($context) {
  $request = $context.Request
  $response = $context.Response
  try {
    $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    if ($relative -eq '' -or $relative.EndsWith('/')) { $relative += 'index.html' }

    $path = $null
    try { $path = [IO.Path]::GetFullPath((Join-Path $root $relative)) } catch { }

    # Only files inside the project folder are ever served.
    $inside = $path -and $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)

    if ($inside -and (Test-Path -LiteralPath $path -PathType Leaf)) {
      $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
      $response.ContentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($path)
    } else {
      $response.StatusCode = 404
      $response.ContentType = 'text/plain; charset=utf-8'
      $bytes = [Text.Encoding]::UTF8.GetBytes('404 - arquivo não encontrado')
    }

    $response.Headers['Cache-Control'] = 'no-cache'
    $response.ContentLength64 = $bytes.Length
    if ($request.HttpMethod -ne 'HEAD') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    Write-Host ('  {0}  {1}' -f $response.StatusCode, $request.Url.AbsolutePath)
  } catch {
    # The browser closed the connection mid-response: nothing to do.
  } finally {
    $response.Close()
  }
}

# Use the first free port starting at $Port.
$listener = $null
for ($candidate = $Port; $candidate -lt $Port + 20; $candidate++) {
  $attempt = New-Object System.Net.HttpListener
  $attempt.Prefixes.Add("http://localhost:$candidate/")
  try {
    $attempt.Start()
    $listener = $attempt
    $Port = $candidate
    break
  } catch {
    $attempt.Close()
  }
}

if (-not $listener) {
  Write-Host "Nenhuma porta livre entre $Port e $($Port + 19). Feche outros servidores e tente de novo."
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  BLACK HOLE - servidor local'
Write-Host "  Abrindo $url"
Write-Host '  Deixe esta janela aberta enquanto usa o projeto. Para parar: feche-a ou pressione Ctrl+C.'
Write-Host ''

if (-not $NoBrowser) {
  try { Start-Process $url } catch { Write-Host "  Abra $url no navegador." }
}

try {
  while ($listener.IsListening) {
    $pending = $listener.GetContextAsync()
    # Short waits keep Ctrl+C responsive.
    while (-not $pending.Wait(500)) { }
    Send-Response $pending.Result
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
