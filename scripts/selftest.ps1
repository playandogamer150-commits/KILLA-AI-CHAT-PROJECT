$ErrorActionPreference = "Stop"

function Get-ErrorBody {
  param([Parameter(Mandatory = $true)] $ErrorRecord)
  try {
    # PowerShell sometimes stores the response payload here for Invoke-RestMethod/Invoke-WebRequest.
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
      return $ErrorRecord.ErrorDetails.Message
    }

    $resp = $ErrorRecord.Exception.Response
    if (-not $resp) { return $null }

    # Windows PowerShell: WebException.Response is an HttpWebResponse with a stream.
    if ($resp -is [System.Net.HttpWebResponse]) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $txt = $sr.ReadToEnd()
      $sr.Close()
      return $txt
    }

    # PowerShell 7+: HttpResponseException.Response is an HttpResponseMessage
    if ($resp -is [System.Net.Http.HttpResponseMessage]) {
      return $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }

    return $null
  } catch {
    return $null
  }
}

function Get-FreePort {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

function Wait-ForHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$Tries = 30,
    [int]$DelayMs = 300
  )
  $health = $null
  for ($i = 0; $i -lt $Tries; $i++) {
    try {
      $health = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
      break
    } catch {
      Start-Sleep -Milliseconds $DelayMs
    }
  }
  return $health
}


$port = Get-FreePort
$base = "http://localhost:$port"

Write-Output "Starting backend..."
$previousPort = $env:PORT
$env:PORT = "$port"
$proc = Start-Process -FilePath node -ArgumentList "server/index.js" -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru

try {
  $health = Wait-ForHealth -Url "$base/api/health"
  if (-not $health) { throw "Backend did not start on $base" }

  Write-Output ("HEALTH ok | modelslab={0} xai={1}" -f $health.apis.modelslab, $health.apis.xai)

  $prompt = "Test image: a simple teal triangle centered on black background, minimal, high contrast, no text."

  foreach ($mid in @("seedream-4.5", "nano-banana-pro")) {
    $body = @{ prompt = $prompt; aspectRatio = "1:1"; model_id = $mid } | ConvertTo-Json -Compress
    try {
      $resp = Invoke-RestMethod -Uri "$base/api/image/generate" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 300
      $count = 0
      if ($resp.urls) { $count = @($resp.urls).Count }
      Write-Output ("CREATE_IMAGES {0}: success={1} urls={2}" -f $mid, $resp.success, $count)
    } catch {
      $bodyTxt = Get-ErrorBody -ErrorRecord $_
      Write-Output ("CREATE_IMAGES {0}: FAIL {1}" -f $mid, $_.Exception.Message)
      if ($bodyTxt) { Write-Output ("  body: {0}" -f $bodyTxt) }
    }
  }

  function New-TestJpegDataUrl {
    param([int]$Size = 256)
    try {
      Add-Type -AssemblyName System.Drawing | Out-Null

      $bmp = New-Object System.Drawing.Bitmap $Size, $Size
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.Clear([System.Drawing.Color]::Black)

      $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 180, 170))
      $p1 = New-Object System.Drawing.Point ([int]($Size / 2)), 18
      $p2 = New-Object System.Drawing.Point 18, ([int]($Size - 18))
      $p3 = New-Object System.Drawing.Point ([int]($Size - 18)), ([int]($Size - 18))
      $points = @($p1, $p2, $p3)
      $g.FillPolygon($brush, $points)

      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
      $b64 = [Convert]::ToBase64String($ms.ToArray())

      $g.Dispose()
      $brush.Dispose()
      $bmp.Dispose()
      $ms.Dispose()

      return "data:image/jpeg;base64,$b64"
    } catch {
      # Fallback: tiny 1x1 JPEG data URL.
      return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhISEhIVFhUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFxEBAQEBAAAAAAAAAAAAAAAAAAEAEv/aAAwDAQACEAMQAAAB3gAAAAAAAAAAAP/EABcQAQEBAQAAAAAAAAAAAAAAAAEAESH/2gAIAQEAAQUCkqgqv//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwFh/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/9oACAECAQE/AVH/xAAaEAACAwEBAAAAAAAAAAAAAAAAAREhAAIx/9oACAEBAAY/Ap6pKX2b/8QAHhABAQEAAgIDAQAAAAAAAAAAAQARITFBUWFxgZH/2gAIAQEAAT8h6xS1yT8p5tG5gV0o7QK2nYVfYdI4cBv/2gAMAwEAAgADAAAAEO//xAAWEQEBAQAAAAAAAAAAAAAAAAABEBH/2gAIAQMBAT8QyGf/xAAWEQEBAQAAAAAAAAAAAAAAAAABEBH/2gAIAQIBAT8QdGf/xAAfEAEAAgIBBQAAAAAAAAAAAAABABEhMUFhcaGx0fD/2gAIAQEAAT8Q0p7j1C2yqkqv4p9FQ7Z3gHqj3V0ZQvKQmQqzTjZcWgGmFQdC1n//Z"
    }
  }

  # Use a small but valid JPEG attachment payload (256x256).
  $testJpeg = New-TestJpegDataUrl -Size 256

  $editBody = @{ prompt = "Transform this into a green circle on a white background."; image = $testJpeg; aspectRatio = "1:1" } | ConvertTo-Json -Compress
  try {
    $resp = Invoke-RestMethod -Uri "$base/api/image/edit" -Method Post -ContentType "application/json" -Body $editBody -TimeoutSec 300
    $count = 0
    if ($resp.urls) { $count = @($resp.urls).Count }
    Write-Output ("EDIT_IMAGE: success={0} urls={1}" -f $resp.success, $count)
  } catch {
    $bodyTxt = Get-ErrorBody -ErrorRecord $_
    Write-Output ("EDIT_IMAGE: FAIL {0}" -f $_.Exception.Message)
    if ($bodyTxt) { Write-Output ("  body: {0}" -f $bodyTxt) }
  }

  $videoBody = @{ prompt = "A 5-second video of a green dot moving left to right on a dark background."; image_url = $testJpeg; duration = 5; aspect_ratio = "16:9"; resolution = "480p" } | ConvertTo-Json -Compress
  try {
    $gen = Invoke-RestMethod -Uri "$base/api/video/generate" -Method Post -ContentType "application/json" -Body $videoBody -TimeoutSec 60
    Write-Output ("CREATE_VIDEO: success={0} request_id={1}" -f $gen.success, $gen.request_id)

    if ($gen.request_id) {
      $maxPolls = 24 # ~2 minutes
      $delaySec = 5
      $done = $false

      for ($i = 0; $i -lt $maxPolls; $i++) {
        Start-Sleep -Seconds $delaySec
        $status = Invoke-RestMethod -Uri ("$base/api/video/status/{0}" -f $gen.request_id) -Method Get -TimeoutSec 20
        Write-Output ("VIDEO_STATUS: status={0}" -f $status.status)

        if ($status.status -eq "done" -and $status.video -and $status.video.url) {
          Write-Output "VIDEO_STATUS: url received"
          $done = $true
          break
        }

        if ($status.status -eq "expired" -or $status.status -eq "error") {
          Write-Output ("VIDEO_STATUS: failed {0}" -f ($status.error))
          break
        }
      }

      if (-not $done) {
        Write-Output ("VIDEO_STATUS: still pending after ~{0}s" -f ($maxPolls * $delaySec))
      }
    }
  } catch {
    $bodyTxt = Get-ErrorBody -ErrorRecord $_
    Write-Output ("CREATE_VIDEO: FAIL {0}" -f $_.Exception.Message)
    if ($bodyTxt) { Write-Output ("  body: {0}" -f $bodyTxt) }
  }
} finally {
  try { Stop-Process -Id $proc.Id -Force } catch {}
  if ($null -ne $previousPort) {
    $env:PORT = $previousPort
  } else {
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
  }
}
