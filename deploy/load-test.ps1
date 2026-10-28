# ==============================================================================
# Dexter Write — College Lab Load Test Script (PowerShell for Windows)
# ==============================================================================
param (
    [string]$TargetHost = "http://localhost:8080",
    [int]$TotalRequests = 300,
    [int]$DelayMs = 20
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting Dexter Write Load Test against: $TargetHost" -ForegroundColor Green
Write-Host " Total Requests: $TotalRequests" -ForegroundColor Yellow
Write-Host " Watch your live Grafana dashboard at: http://localhost:3001" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$successCount = 0
$errorCount = 0

for ($i = 1; $i -le $TotalRequests; $i++) {
    try {
        # Alternate between health endpoint and metrics
        $endpoint = if ($i % 5 -eq 0) { "$TargetHost/invalid-test" } elseif ($i % 2 -eq 0) { "$TargetHost/metrics" } else { "$TargetHost/health" }
        $response = Invoke-WebRequest -Uri $endpoint -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $successCount++
        } else {
            $errorCount++
        }
    } catch {
        $errorCount++
    }

    if ($i % 25 -eq 0) {
        Write-Host "Progress: $i / $TotalRequests requests sent (Success: $successCount, Errors: $errorCount)" -ForegroundColor Gray
    }

    if ($DelayMs -gt 0) {
        Start-Sleep -Milliseconds $DelayMs
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Load test complete!" -ForegroundColor Green
Write-Host " Total Sent: $TotalRequests | Success: $successCount | Errors: $errorCount" -ForegroundColor Green
Write-Host " Check Grafana at http://localhost:3001 for live spikes!" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

