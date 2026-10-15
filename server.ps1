# Ізім — API и готовый React-фронт из dist\
# Запуск: powershell -ExecutionPolicy Bypass -File .\server.ps1
# Сборка фронта: npm run build
# Разработка с горячей перезагрузкой: npm run dev  (http://127.0.0.1:5173)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Port = 5500
$EnvFile = Join-Path $Root ".env"

function Read-DotEnv {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  Get-Content -Path $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $key = $line.Substring(0, $i).Trim()
    $val = $line.Substring($i + 1).Trim()
    if (
      ($val.StartsWith('"') -and $val.EndsWith('"')) -or
      ($val.StartsWith("'") -and $val.EndsWith("'"))
    ) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $map[$key] = $val
  }
  return $map
}

function Get-MimeType([string]$ext) {
  switch ($ext.ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css"  { "text/css; charset=utf-8" }
    ".js"   { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png"  { "image/png" }
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".webp" { "image/webp" }
    ".svg"  { "image/svg+xml" }
    ".ico"  { "image/x-icon" }
    ".woff2"{ "font/woff2" }
    ".txt"  { "text/plain; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

function Write-JsonResponse($Response, [int]$Status, $Object) {
  $json = ($Object | ConvertTo-Json -Compress -Depth 8)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Response.StatusCode = $Status
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Read-RequestBody($Request) {
  $reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

$SqliteFile = Join-Path $Root "data\izim.sqlite"
$script:BarysRate = @{}
$BarysRateLimit = 20
$BarysRateWindowSec = 60
$BlockedStaticNames = @(
  ".env", ".env.local", ".env.production",
  "server.ps1", "barys-system.txt"
)

$script:RouteRates = @{}
$script:ChatJobs = @()
$script:ChatPool = $null

function Test-RouteRateLimit([string]$Name, [string]$ClientIp, [int]$Limit) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $ip = if ([string]::IsNullOrWhiteSpace($ClientIp)) { "unknown" } else { $ClientIp }
  $key = "$Name|$ip"
  $bucket = $script:RouteRates[$key]
  if (-not $bucket -or ($now - $bucket.start) -ge 60) {
    $script:RouteRates[$key] = @{ start = $now; count = 1 }
    return $true
  }
  if ($bucket.count -ge $Limit) { return $false }
  $bucket.count++
  return $true
}

function Get-ClientIp($Request) {
  $remote = ""
  try { $remote = $Request.RemoteEndPoint.Address.ToString() } catch { $remote = "" }
  $loopback = $remote -eq "127.0.0.1" -or $remote -eq "::1" -or $remote -eq "0:0:0:0:0:0:0:1"
  if ($loopback) {
    foreach ($header in @("X-Forwarded-For", "X-Real-IP")) {
      $raw = [string]$Request.Headers[$header]
      if ([string]::IsNullOrWhiteSpace($raw)) { continue }
      $first = ($raw -split ",")[0].Trim().Trim("[]")
      if ($first -match '^[0-9A-Fa-f:\.]+$') { return $first }
    }
  }
  if ([string]::IsNullOrWhiteSpace($remote)) { return "unknown" }
  return $remote
}

function Test-BarysRateLimit([string]$ClientIp) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $key = if ([string]::IsNullOrWhiteSpace($ClientIp)) { "unknown" } else { $ClientIp }
  $bucket = $script:BarysRate[$key]
  if (-not $bucket -or ($now - $bucket.start) -ge $BarysRateWindowSec) {
    $script:BarysRate[$key] = @{ start = $now; count = 1 }
    return $true
  }
  if ($bucket.count -ge $BarysRateLimit) { return $false }
  $bucket.count++
  return $true
}

function Invoke-WorkerRequest([string]$Method, [string]$WorkerPath, [string]$JsonBody, [string]$AdminPassword) {
  $resp = $null
  try {
    try { [System.Net.ServicePointManager]::Expect100Continue = $false } catch {}
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510$WorkerPath")
    try { $req.ServicePoint.Expect100Continue = $false } catch {}
    $req.Method = $Method
    $req.Timeout = 100000
    $req.ReadWriteTimeout = 100000
    if (-not [string]::IsNullOrWhiteSpace($AdminPassword)) {
      $req.Headers.Add("X-Admin-Password", $AdminPassword)
    }
    if ($Method -ne "GET" -and $Method -ne "HEAD") {
      $req.ContentType = "application/json; charset=utf-8"
      $payload = if ($null -eq $JsonBody) { "" } else { $JsonBody }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
      $req.ContentLength = $bytes.Length
      $stream = $req.GetRequestStream()
      try { if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) } } finally { $stream.Close() }
    }
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
    return @{ ok = $true; status = [int]$resp.StatusCode; body = $text }
  } catch [System.Net.WebException] {
    $webResp = $_.Exception.Response
    if ($webResp) {
      try {
        $reader = New-Object System.IO.StreamReader($webResp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
        $code = [int]$webResp.StatusCode
        if ($code -lt 100) { $code = 502 }
        return @{ ok = $true; status = $code; body = $text }
      } catch {}
    }
    return @{ ok = $false; status = 503; body = "" }
  } catch {
    return @{ ok = $false; status = 503; body = "" }
  } finally {
    if ($resp) { try { $resp.Close() } catch {} }
  }
}

function Write-RawJson($Response, [int]$Status, [string]$Json) {
  if ([string]::IsNullOrWhiteSpace($Json)) { $Json = '{"error":"empty worker response"}' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $Response.StatusCode = $Status
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Read-ResponseBytes($WebResponse) {
  $stream = $WebResponse.GetResponseStream()
  $memory = New-Object System.IO.MemoryStream
  try {
    $stream.CopyTo($memory)
    return $memory.ToArray()
  } finally {
    try { $stream.Close() } catch {}
    try { $memory.Close() } catch {}
  }
}

function Invoke-WorkerBinaryRequest([string]$Method, [string]$WorkerPath, [string]$JsonBody, [string]$AdminPassword) {
  $resp = $null
  try {
    try { [System.Net.ServicePointManager]::Expect100Continue = $false } catch {}
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510$WorkerPath")
    try { $req.ServicePoint.Expect100Continue = $false } catch {}
    $req.Method = $Method
    $req.Timeout = 180000
    $req.ReadWriteTimeout = 180000
    if (-not [string]::IsNullOrWhiteSpace($AdminPassword)) {
      $req.Headers.Add("X-Admin-Password", $AdminPassword)
    }
    if ($Method -ne "GET" -and $Method -ne "HEAD") {
      $req.ContentType = "application/json; charset=utf-8"
      $payload = if ($null -eq $JsonBody) { "" } else { $JsonBody }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
      $req.ContentLength = $bytes.Length
      $stream = $req.GetRequestStream()
      try { if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) } } finally { $stream.Close() }
    }
    $resp = $req.GetResponse()
    $bodyBytes = Read-ResponseBytes $resp
    $disp = ""
    try { $disp = [string]$resp.Headers["Content-Disposition"] } catch { $disp = "" }
    return @{
      ok = $true
      status = [int]$resp.StatusCode
      bytes = $bodyBytes
      contentType = [string]$resp.ContentType
      disposition = $disp
    }
  } catch [System.Net.WebException] {
    $webResp = $_.Exception.Response
    if ($webResp) {
      try {
        $bodyBytes = Read-ResponseBytes $webResp
        $code = [int]$webResp.StatusCode
        if ($code -lt 100) { $code = 502 }
        $ctype = ""
        $disp = ""
        try { $ctype = [string]$webResp.ContentType } catch { $ctype = "" }
        try { $disp = [string]$webResp.Headers["Content-Disposition"] } catch { $disp = "" }
        return @{ ok = $true; status = $code; bytes = $bodyBytes; contentType = $ctype; disposition = $disp }
      } catch {}
    }
    return @{ ok = $false; status = 503; bytes = $null; contentType = ""; disposition = "" }
  } catch {
    return @{ ok = $false; status = 503; bytes = $null; contentType = ""; disposition = "" }
  } finally {
    if ($resp) { try { $resp.Close() } catch {} }
  }
}

function Write-BinaryResponse($Response, [int]$Status, [byte[]]$Bytes, [string]$ContentType, [string]$Disposition) {
  if ($null -eq $Bytes) { $Bytes = New-Object byte[] 0 }
  $Response.StatusCode = $Status
  if (-not [string]::IsNullOrWhiteSpace($ContentType)) {
    $Response.ContentType = $ContentType
  }
  if (-not [string]::IsNullOrWhiteSpace($Disposition)) {
    try { $Response.Headers["Content-Disposition"] = $Disposition } catch {}
  }
  $Response.ContentLength64 = $Bytes.LongLength
  if ($Bytes.LongLength -gt 0) {
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  }
}

function Invoke-BarysWorker([string]$JsonBody) {
  $resp = $null
  try {
    try { [System.Net.ServicePointManager]::Expect100Continue = $false } catch {}
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510/chat")
    try { $req.ServicePoint.Expect100Continue = $false } catch {}
    $req.Method = "POST"
    $req.ContentType = "application/json; charset=utf-8"
    $req.Timeout = 110000
    $req.ReadWriteTimeout = 110000
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonBody)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Close() }
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
    return @{ ok = $true; status = [int]$resp.StatusCode; body = $text }
  } catch [System.Net.WebException] {
    $webResp = $_.Exception.Response
    if ($webResp) {
      try {
        $reader = New-Object System.IO.StreamReader($webResp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
        $code = [int]$webResp.StatusCode
        if ($code -lt 100) { $code = 502 }
        return @{ ok = $true; status = $code; body = $text }
      } catch {}
    }
    $status = [string]$_.Exception.Status
    $down = $status -notin @("Timeout", "RequestCanceled")
    return @{ ok = $false; status = 503; body = ""; down = $down }
  } catch {
    return @{ ok = $false; status = 503; body = ""; down = $true }
  } finally {
    if ($resp) { try { $resp.Close() } catch {} }
  }
}

function Add-LocalCors($Request, $Response) {
  $origin = [string]$Request.Headers["Origin"]
  if ([string]::IsNullOrWhiteSpace($origin)) { return }
  $allowed = @(
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
    "http://127.0.0.1:5502",
    "http://localhost:5502"
  )
  if ($allowed -contains $origin) {
    $Response.Headers.Add("Access-Control-Allow-Origin", $origin)
    $Response.Headers.Add("Vary", "Origin")
  }
}

function Stop-ListenPort([int]$ListenPort) {
  try {
    $old = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $old) {
      if ($procId -and $procId -ne $PID) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Resolve-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\resources\helpers\node.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Start-BarysWorker {
  Stop-ListenPort 5510
  Start-Sleep -Milliseconds 300
  $script = Join-Path $Root "barys\worker.js"
  if (-not (Test-Path $script)) {
    Write-Output "Barys worker script missing: $script"
    return
  }
  $nodeExe = Resolve-NodeExe
  if (-not $nodeExe) {
    Write-Output "node not found; Barys answers from the local catalog"
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $nodeExe
  $psi.Arguments = "`"$script`""
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  for ($i = 0; $i -lt 25; $i++) {
    try {
      $probe = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510/health")
      $probe.Method = "GET"
      $probe.Timeout = 500
      $probeResp = $probe.GetResponse()
      $probeResp.Close()
      Write-Output "Barys worker: http://127.0.0.1:5510/"
      return
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }
  Write-Output "Barys worker did not answer on port 5510"
}

# Освободить порт, если занят предыдущим сервером
try {
  $old = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $old) {
    if ($procId -and $procId -ne $PID) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
} catch {}

$envMap = Read-DotEnv $EnvFile
$requiredEnv = @("SUPPORT_EMAIL", "TELEGRAM_USERNAME", "WHATSAPP_NUMBER", "ADMIN_PASSWORD", "OPENAI_API_KEY", "OPENAI_MODEL")
$missingEnv = @()
foreach ($name in $requiredEnv) {
  if ([string]::IsNullOrWhiteSpace($envMap[$name])) { $missingEnv += $name }
}
if ($missingEnv.Count -gt 0) {
  Write-Output ("Не заданы переменные окружения: " + ($missingEnv -join ", "))
  exit 1
}
$listener = $null
foreach ($tryPort in @($Port, 5501, 5502)) {
  try {
    $candidate = [System.Net.HttpListener]::new()
    $candidate.Prefixes.Add("http://127.0.0.1:$tryPort/")
    $candidate.Start()
    $listener = $candidate
    $Port = $tryPort
    break
  } catch {
    if ($candidate) {
      try { $candidate.Close() } catch {}
    }
  }
}
if (-not $listener) {
  throw "Cannot start server on ports 5500-5502. Free the port or run PowerShell as Administrator."
}

$keyStatus = if ([string]::IsNullOrWhiteSpace($envMap["OPENAI_API_KEY"])) { "missing" } else { "ok" }
$DistRoot = Join-Path $Root "dist"
$HasSpa = Test-Path (Join-Path $DistRoot "index.html")

function Test-UnderPath([string]$Full, [string]$RootFull) {
  $base = $RootFull.TrimEnd('\')
  if ($Full.Equals($base, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $Full.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-SiteFile([string]$Relative) {
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  $spa = Test-Path (Join-Path $DistRoot "index.html")
  $liveUpload = $Relative.Replace("\", "/").StartsWith("assets/products/uploads/")
  $candidates = @()
  if ($liveUpload) {
    $candidates += (Join-Path $Root $Relative)
  }
  if ($spa) {
    $candidates += (Join-Path $DistRoot $Relative)
  }
  if (-not $liveUpload) {
    $candidates += (Join-Path $Root $Relative)
  }
  foreach ($candidate in $candidates) {
    $full = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-UnderPath $full $rootFull)) { continue }
    if (Test-Path $full -PathType Leaf) { return $full }
    if (Test-Path $full -PathType Container) {
      $index = Join-Path $full "index.html"
      if (Test-Path $index -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($index)
      }
    }
  }
  return $null
}

Write-Output "Serving http://127.0.0.1:$Port/"
Write-Output "OPENAI_API_KEY: $keyStatus"
Write-Output "SQLite: $SqliteFile"
if ($HasSpa) {
  Write-Output "Frontend: React (dist)"
} else {
  Write-Output "Frontend: dist not found. Run npm run build, or npm run dev for live reload."
}
Start-BarysWorker

$script:ChatWorkerSource = @'
param($Response, $JsonBody, $NodeExe, $WorkerScript, $WorkRoot)
function Write-ChatJson([int]$Status, [string]$Json) {
  if ([string]::IsNullOrWhiteSpace($Json)) { $Json = '{"error":"empty worker response"}' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $Response.StatusCode = $Status
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}
function Send-Chat([string]$Body) {
  $resp = $null
  try {
    try { [System.Net.ServicePointManager]::Expect100Continue = $false } catch {}
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510/chat")
    try { $req.ServicePoint.Expect100Continue = $false } catch {}
    $req.Method = "POST"
    $req.ContentType = "application/json; charset=utf-8"
    $req.Timeout = 110000
    $req.ReadWriteTimeout = 110000
    $payload = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $req.ContentLength = $payload.Length
    $stream = $req.GetRequestStream()
    try { if ($payload.Length -gt 0) { $stream.Write($payload, 0, $payload.Length) } } finally { $stream.Close() }
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
    return @{ ok = $true; status = [int]$resp.StatusCode; body = $text; down = $false }
  } catch [System.Net.WebException] {
    $webResp = $_.Exception.Response
    if ($webResp) {
      try {
        $reader = New-Object System.IO.StreamReader($webResp.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
        $code = [int]$webResp.StatusCode
        if ($code -lt 100) { $code = 502 }
        return @{ ok = $true; status = $code; body = $text; down = $false }
      } catch {}
    }
    $statusName = [string]$_.Exception.Status
    $down = $statusName -notin @("Timeout", "RequestCanceled")
    return @{ ok = $false; status = 503; body = ""; down = $down }
  } catch {
    return @{ ok = $false; status = 503; body = ""; down = $true }
  } finally {
    if ($resp) { try { $resp.Close() } catch {} }
  }
}
function Ensure-ChatWorker {
  if ([string]::IsNullOrWhiteSpace($NodeExe) -or [string]::IsNullOrWhiteSpace($WorkerScript)) { return }
  $mutex = $null
  $owned = $false
  try { $mutex = New-Object System.Threading.Mutex($false, "Local\IzimBarysChatWorker") } catch { return }
  try {
    try { $owned = $mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
    try {
      $probe = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510/health")
      $probe.Method = "GET"
      $probe.Timeout = 800
      $live = $probe.GetResponse()
      $live.Close()
      return
    } catch {}
    try {
      $owners = Get-NetTCPConnection -LocalPort 5510 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($procId in $owners) {
        if ($procId -and $procId -ne $PID) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
      }
    } catch {}
    Start-Sleep -Milliseconds 300
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.Arguments = '"' + $WorkerScript + '"'
    $psi.WorkingDirectory = $WorkRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    for ($i = 0; $i -lt 25; $i++) {
      try {
        $probe = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5510/health")
        $probe.Method = "GET"
        $probe.Timeout = 500
        $live = $probe.GetResponse()
        $live.Close()
        return
      } catch { Start-Sleep -Milliseconds 200 }
    }
  } finally {
    if ($owned) { try { $mutex.ReleaseMutex() } catch {} }
    try { $mutex.Dispose() } catch {}
  }
}
try {
  $proxied = Send-Chat $JsonBody
  if (-not $proxied.ok -and $proxied.down) {
    Ensure-ChatWorker
    $proxied = Send-Chat $JsonBody
  }
  if (-not $proxied.ok) {
    Write-ChatJson 503 '{"error":"Barys worker unavailable"}'
    return
  }
  $status = [int]$proxied.status
  if ($status -lt 100 -or $status -gt 599) { $status = 502 }
  Write-ChatJson $status ([string]$proxied.body)
} catch {
  try { Write-ChatJson 503 '{"error":"Barys worker unavailable"}' } catch {}
} finally {
  try { $Response.OutputStream.Close() } catch {}
}
'@

function Complete-ChatJobs {
  $pending = @()
  foreach ($job in @($script:ChatJobs)) {
    if ($job.Handle.IsCompleted) {
      try { $job.PS.EndInvoke($job.Handle) | Out-Null } catch {}
      try { $job.PS.Dispose() } catch {}
      try { if ($job.Response) { $job.Response.OutputStream.Close() } } catch {}
    } else {
      $pending += $job
    }
  }
  $script:ChatJobs = $pending
}

function Start-ChatProxy($Response, [string]$JsonBody) {
  $ps = [powershell]::Create()
  $ps.RunspacePool = $script:ChatPool
  [void]$ps.AddScript($script:ChatWorkerSource)
  [void]$ps.AddArgument($Response)
  [void]$ps.AddArgument($JsonBody)
  [void]$ps.AddArgument((Resolve-NodeExe))
  [void]$ps.AddArgument((Join-Path $Root "barys\worker.js"))
  [void]$ps.AddArgument($Root)
  $handle = $ps.BeginInvoke()
  $script:ChatJobs += @{ PS = $ps; Handle = $handle; Response = $Response }
}

$script:ChatPool = [runspacefactory]::CreateRunspacePool(1, 6)
$script:ChatPool.Open()

try {
while ($listener.IsListening) {
  Complete-ChatJobs
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $defer = $false

  try {
    Add-LocalCors $req $res
    $res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password")
    $path = $req.Url.AbsolutePath

    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      continue
    }

    if ($path -eq "/api/barys" -and $req.HttpMethod -eq "POST") {
      $clientIp = Get-ClientIp $req
      if (-not (Test-BarysRateLimit $clientIp)) {
        Write-JsonResponse $res 429 @{ error = "Слишком много запросов. Подождите минуту." }
        continue
      }
      $raw = Read-RequestBody $req
      if ($raw.Length -gt 6291456) {
        Write-JsonResponse $res 413 @{ error = "request too large" }
        continue
      }
      $body = $null
      try { $body = $raw | ConvertFrom-Json } catch {}
      $message = if ($body -and $body.message) { [string]$body.message } else { "" }
      if ($message.Length -gt 4000) { $message = $message.Substring(0, 4000) }
      $attachments = @()
      if ($body -and $null -ne $body.attachments) { $attachments = @($body.attachments) }
      if ($attachments.Count -gt 3) { $attachments = @($attachments[0..2]) }
      if ([string]::IsNullOrWhiteSpace($message) -and $attachments.Count -lt 1) {
        Write-JsonResponse $res 400 @{ error = "message or attachment required" }
        continue
      }
      $history = @()
      if ($body -and $null -ne $body.history) { $history = @($body.history) }
      if ($history.Count -gt 12) { $history = @($history[($history.Count - 12)..($history.Count - 1)]) }
      $currency = if ($body -and $body.currency) { [string]$body.currency } else { "kzt" }
      $forward = @{
        message = $message.Trim()
        attachments = @($attachments)
        history = @($history)
        currency = $currency
      }
      $forwardJson = $forward | ConvertTo-Json -Depth 20 -Compress
      if (@($script:ChatJobs).Count -ge 6) {
        Write-JsonResponse $res 429 @{ error = "Слишком много запросов. Подождите минуту." }
        continue
      }
      Start-ChatProxy $res $forwardJson
      $defer = $true
      continue
    }

    if ($path -eq "/api/health") {
      $envMap = Read-DotEnv $EnvFile
      $hasKey = -not [string]::IsNullOrWhiteSpace($envMap["OPENAI_API_KEY"])
      Write-JsonResponse $res 200 @{ ok = $true; openai = $hasKey }
      continue
    }

    if ($path -eq "/api/contacts") {
      $envMap = Read-DotEnv $EnvFile
      $wa = $envMap["WHATSAPP_NUMBER"].Trim()
      $tg = ($envMap["TELEGRAM_USERNAME"] -replace '^@', '').Trim()
      $mail = $envMap["SUPPORT_EMAIL"].Trim()
      Write-JsonResponse $res 200 @{
        ok = $true
        whatsapp = $wa
        whatsappUrl = "https://wa.me/$wa"
        telegram = $tg
        telegramUrl = if ($tg) { "https://t.me/$tg" } else { "" }
        email = $mail
      }
      continue
    }

    if ($path -eq "/api/products" -or $path -eq "/api/orders" -or $path -eq "/api/orders/quote" -or $path -eq "/api/admin/organization" -or $path -eq "/api/admin/session") {
      $allowed = @{
        "/api/products" = @("GET", "PUT", "POST", "PATCH", "DELETE")
        "/api/orders" = @("GET", "POST", "PATCH")
        "/api/orders/quote" = @("POST")
        "/api/admin/organization" = @("GET", "PUT")
        "/api/admin/session" = @("POST", "DELETE")
      }
      if ($allowed[$path] -notcontains $req.HttpMethod) {
        Write-JsonResponse $res 405 @{ error = "method not allowed" }
        continue
      }
      $raw = ""
      if ($req.HttpMethod -ne "GET") {
        $raw = Read-RequestBody $req
        $limit = if ($path -eq "/api/products") { 15728640 } else { 1048576 }
        if ($raw.Length -gt $limit) {
          Write-JsonResponse $res 413 @{ error = "request too large" }
          continue
        }
      }
      $admin = $req.Headers["X-Admin-Password"]
      if (-not $admin) { $admin = "" }
      $clientIp = Get-ClientIp $req
      if ($path -eq "/api/admin/session" -and $req.HttpMethod -eq "POST") {
        if (-not (Test-RouteRateLimit "login" $clientIp 8)) {
          Write-JsonResponse $res 429 @{ error = "Слишком много попыток. Подождите минуту." }
          continue
        }
      }
      if ($path -eq "/api/orders" -and $req.HttpMethod -eq "POST") {
        if (-not (Test-RouteRateLimit "order" $clientIp 12)) {
          Write-JsonResponse $res 429 @{ error = "Слишком много заявок. Подождите минуту." }
          continue
        }
      }
      $workerPath = $req.Url.PathAndQuery
      $proxied = Invoke-WorkerRequest $req.HttpMethod $workerPath $raw $admin
      if (-not $proxied.ok) {
        Start-BarysWorker
        $proxied = Invoke-WorkerRequest $req.HttpMethod $workerPath $raw $admin
      }
      if (-not $proxied.ok) {
        Write-JsonResponse $res 503 @{ error = "database worker unavailable" }
        continue
      }
      $status = [int]$proxied.status
      if ($status -lt 100 -or $status -gt 599) { $status = 502 }
      Write-RawJson $res $status ([string]$proxied.body)
      continue
    }

    if ($path -eq "/api/documents/catalog" -or $path -eq "/api/documents/order" -or $path -eq "/api/documents/invoice" -or $path -eq "/api/documents/invoice-factura") {
      $isBinaryGet = $path -eq "/api/documents/order" -or $path -eq "/api/documents/invoice" -or $path -eq "/api/documents/invoice-factura"
      if ($isBinaryGet -and $req.HttpMethod -ne "GET") {
        Write-JsonResponse $res 405 @{ error = "method not allowed" }
        continue
      }
      if (-not $isBinaryGet -and $req.HttpMethod -ne "POST") {
        Write-JsonResponse $res 405 @{ error = "method not allowed" }
        continue
      }
      $raw = ""
      if (-not $isBinaryGet) {
        $raw = Read-RequestBody $req
        if ($raw.Length -gt 1048576) {
          Write-JsonResponse $res 413 @{ error = "request too large" }
          continue
        }
      }
      $admin = $req.Headers["X-Admin-Password"]
      if (-not $admin) { $admin = "" }
      if ($path -eq "/api/documents/catalog") {
        $clientIp = Get-ClientIp $req
        if (-not (Test-RouteRateLimit "catalog" $clientIp 10)) {
          Write-JsonResponse $res 429 @{ error = "Слишком много запросов. Подождите минуту." }
          continue
        }
      }
      $proxied = Invoke-WorkerBinaryRequest $req.HttpMethod $req.Url.PathAndQuery $raw $admin
      if (-not $proxied.ok) {
        Start-BarysWorker
        $proxied = Invoke-WorkerBinaryRequest $req.HttpMethod $req.Url.PathAndQuery $raw $admin
      }
      if (-not $proxied.ok) {
        Write-JsonResponse $res 503 @{ error = "database worker unavailable" }
        continue
      }
      $status = [int]$proxied.status
      if ($status -lt 100 -or $status -gt 599) { $status = 502 }
      $ctype = $proxied.contentType
      if ([string]::IsNullOrWhiteSpace($ctype)) {
        $ctype = if ($status -eq 200) { "application/pdf" } else { "application/json; charset=utf-8" }
      }
      Write-BinaryResponse $res $status $proxied.bytes $ctype $proxied.disposition
      continue
    }

    $rel = [Uri]::UnescapeDataString($path.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $relNorm = $rel.Replace("\", "/").TrimStart("/")
    $leafName = [System.IO.Path]::GetFileName($relNorm)
    $blocked =
      ($BlockedStaticNames -contains $leafName.ToLowerInvariant()) -or
      ($leafName -like ".env*") -or
      ($relNorm -like "data/*") -or
      ($relNorm -like ".git/*") -or
      ($relNorm -like "node_modules/*") -or
      ($relNorm -eq "node_modules") -or
      ($relNorm -like "src/*")
    if ($blocked) {
      $res.StatusCode = 404
      continue
    }
    $filePath = Resolve-SiteFile $relNorm
    $spaNow = Test-Path (Join-Path $DistRoot "index.html")
    if (-not $filePath -and $spaNow) {
      $ext = [System.IO.Path]::GetExtension($relNorm)
      if ([string]::IsNullOrWhiteSpace($ext)) {
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $DistRoot "index.html"))
      }
    }
    if (-not $filePath -or -not (Test-Path $filePath -PathType Leaf)) {
      $res.StatusCode = 404
      continue
    }
    $rootFull = [System.IO.Path]::GetFullPath($Root)
    if (-not (Test-UnderPath ([System.IO.Path]::GetFullPath($filePath)) $rootFull)) {
      $res.StatusCode = 403
      continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $res.ContentType = Get-MimeType ([System.IO.Path]::GetExtension($filePath))
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Write-Output ("API error: " + $_.Exception.ToString())
    try { Write-JsonResponse $res 500 @{ error = "Internal Server Error" } } catch {}
  } finally {
    if (-not $defer) {
      try { $res.OutputStream.Close() } catch {}
    }
  }
}
} finally {
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while (@($script:ChatJobs).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
    Complete-ChatJobs
    Start-Sleep -Milliseconds 50
  }
  foreach ($job in @($script:ChatJobs)) {
    try { $job.PS.Stop() } catch {}
    try { $job.PS.Dispose() } catch {}
    try { if ($job.Response) { $job.Response.OutputStream.Close() } } catch {}
  }
  try { if ($script:ChatPool) { $script:ChatPool.Close(); $script:ChatPool.Dispose() } } catch {}
  try { if ($listener) { $listener.Stop() } } catch {}
  Stop-ListenPort 5510
}
