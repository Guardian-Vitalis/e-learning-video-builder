$ErrorActionPreference = "Stop"

$baseUrl = $env:EVB_LOCAL_AVATAR_ENGINE_URL
if (-not $baseUrl) { $baseUrl = "http://localhost:5600" }

$url = "$baseUrl/v1/local-avatar/health"
$res = Invoke-WebRequest -Uri $url -UseBasicParsing
Write-Output $res.Content
