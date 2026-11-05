# Dexter Write — Grafana k6 Load Benchmark Runner (PowerShell)
param (
    [string]$TargetHost = "http://localhost:8080"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Dexter Write — Grafana k6 Cloud Performance Test       " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target: $TargetHost" -ForegroundColor Green
Write-Host "Simulating 25 Concurrent Virtual Users across 50 seconds..." -ForegroundColor Cyan

$ScriptPath = "$PSScriptRoot\load-test.js"

if (Get-Command k6 -ErrorAction SilentlyContinue) {
    Write-Host "[Running via native k6 binary]" -ForegroundColor Green
    $env:TARGET_HOST = $TargetHost
    k6 run $ScriptPath
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "[Running via official Docker image: grafana/k6]" -ForegroundColor Green
    # Translate localhost to host.docker.internal if target is local
    $DockerTarget = $TargetHost -replace "localhost", "host.docker.internal" -replace "127.0.0.1", "host.docker.internal"
    Get-Content $ScriptPath | docker run --rm -i -e "TARGET_HOST=$DockerTarget" grafana/k6 run -
} else {
    Write-Host "[!] Neither k6 nor docker CLI found. Falling back to PowerShell concurrent loop..." -ForegroundColor Yellow
    1..20 | ForEach-Object {
        Start-ThreadJob -ScriptBlock {
            param($url)
            1..25 | ForEach-Object {
                try { Invoke-RestMethod -Uri "$url/health" -TimeoutSec 2 | Out-Null } catch {}
            }
        } -ArgumentList $TargetHost
    } | Wait-Job | Remove-Job
    Write-Host "Concurrent burst completed. Check Grafana dashboard for metrics spike!" -ForegroundColor Green
}

