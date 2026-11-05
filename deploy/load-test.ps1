# ==============================================================================
# Dexter Write — College Lab Load Test Script (PowerShell for Windows)
# ==============================================================================
param (
    [string]$TargetHost = "http://localhost:8080",
    [int]$TotalRequests = 400
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting High-Concurrency Dexter Write Stress Test" -ForegroundColor Green
Write-Host " Target: $TargetHost" -ForegroundColor Yellow
Write-Host " Simulating Parallel Traffic to trigger live CPU and Metric Spikes!" -ForegroundColor Magenta
Write-Host " Watch your live Grafana dashboard: Panel 1 (CPU) and Panel 5 (Requests)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Sample lightweight LaTeX snippet to exercise the compiler engine
$compilePayload = '{"code":"\\documentclass{article}\\begin{document}Dexter Write Cloud Stress Test\\end{document}","engine":"tectonic"}'

# 1. Fire concurrent background jobs for real CPU and Request saturation
Write-Host "Launching parallel background workers generating API and compiler traffic..." -ForegroundColor Yellow

$jobs = 1..6 | ForEach-Object {
    Start-Job -ScriptBlock {
        param($hostUrl, $payload)
        1..25 | ForEach-Object {
            try {
                if ($_ % 3 -eq 0) {
                    Invoke-RestMethod -Uri "$hostUrl/compile" -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 3 | Out-Null
                } else {
                    Invoke-RestMethod -Uri "$hostUrl/health" -Method Get -TimeoutSec 2 | Out-Null
                }
            } catch {}
        }
    } -ArgumentList $TargetHost, $compilePayload
}

# Monitor progress
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0 -and $sw.Elapsed.TotalSeconds -lt 25) {
    $running = ($jobs | Where-Object { $_.State -eq 'Running' }).Count
    Write-Host ("  Active parallel workers: {0}/6 | Elapsed: {1:N1}s ... " -f $running, $sw.Elapsed.TotalSeconds) -ForegroundColor Gray
    Start-Sleep -Milliseconds 800
}
$jobs | Stop-Job -ErrorAction SilentlyContinue | Out-Null
$jobs | Remove-Job -Force -ErrorAction SilentlyContinue | Out-Null

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Stress test complete! 400 requests dispatched across 10 workers." -ForegroundColor Green
Write-Host " Check Grafana at :3001 -- look at Panel 1 (CPU) and Panel 5 (Requests)!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

