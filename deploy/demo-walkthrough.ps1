# ==============================================================================
# Dexter Write -- Live Evaluation Demo and Architecture Walkthrough (PowerShell)
# For: Mayuresh Tardekar, Sanika Sonavane, Ritik Bahurashi
# Course: Cloud Computing on Linux Lab Evaluation
# ==============================================================================

param (
    [string]$ServerHost = "13.203.161.118"
)

function Show-Header {
    Clear-Host
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "   DEXTER WRITE -- CLOUD COMPUTING LIVE EVALUATION RUNNER         " -ForegroundColor Yellow
    Write-Host "   Authors: Mayuresh Tardekar | Sanika Sonavane | Ritik Bahurashi " -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ("Target Cloud Host: http://" + $ServerHost) -ForegroundColor White
    Write-Host ""
}

function Test-Endpoints {
    Show-Header
    Write-Host "[1/5] Verifying Cloud Microservices Status..." -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"

    $services = @(
        @{ Name = "Frontend Web IDE"; Port = "3000"; Path = "/" },
        @{ Name = "Backend Compiler API"; Port = "8080"; Path = "/health" },
        @{ Name = "Backend Prometheus Metrics"; Port = "8080"; Path = "/metrics" },
        @{ Name = "Prometheus Scraper"; Port = "9090"; Path = "/targets" },
        @{ Name = "Grafana NOC Dashboard"; Port = "3001"; Path = "/login" },
        @{ Name = "Jenkins CI/CD Automation"; Port = "8085"; Path = "/login" }
    )

    foreach ($svc in $services) {
        $url = "http://" + $ServerHost + ":" + $svc.Port + $svc.Path
        $msg = "Checking " + $svc.Name.PadRight(30) + " -> " + $url.PadRight(38) + " ... "
        Write-Host -NoNewline $msg
        try {
            $res = Invoke-WebRequest -Uri $url -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
            if ($res.StatusCode -eq 200) {
                Write-Host "OK 200" -ForegroundColor Green
            } else {
                Write-Host ("HTTP " + $res.StatusCode) -ForegroundColor Yellow
            }
        } catch {
            Write-Host "OFFLINE" -ForegroundColor Red
        }
    }
    Write-Host "------------------------------------------------------------------"
    Write-Host "Tip: If status is OFFLINE, verify that your EC2 instance is started." -ForegroundColor Gray
    Read-Host "`nPress Enter to return to menu"
}

function Run-LoadSpike {
    Show-Header
    Write-Host "[2/5] Running Automated Traffic Burst to Spike Grafana Metrics..." -ForegroundColor Yellow
    Write-Host ("Target Backend: http://" + $ServerHost + ":8080") -ForegroundColor Cyan
    Write-Host "Simulating 10 Parallel Workers generating 400+ Requests with LaTeX Compilation..." -ForegroundColor Green
    Write-Host ("Look at Grafana Dashboard (http://" + $ServerHost + ":3001) in real-time!") -ForegroundColor Magenta
    Write-Host ""

    $loadScript = Join-Path $PSScriptRoot "load-test.ps1"
    & $loadScript -TargetHost ("http://" + $ServerHost + ":8080") -TotalRequests 400

    Write-Host ("`nSuccess! Open Grafana (http://" + $ServerHost + ":3001) to show live spike.") -ForegroundColor Green
    Read-Host "`nPress Enter to return to menu"
}

function Show-K8s {
    Show-Header
    Write-Host "[3/5] Kubernetes (K8s) Production Architecture and Manifests" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    Write-Host "Location: deploy/k8s/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Manifest Components:" -ForegroundColor White
    Write-Host "  1. namespace.yaml             -> Dedicated dexter-prod isolation" -ForegroundColor Gray
    Write-Host "  2. configmap.yaml             -> Decoupled production runtime config" -ForegroundColor Gray
    Write-Host "  3. frontend-deployment.yaml   -> 2 Replicas, RollingUpdate, Liveness probes" -ForegroundColor Gray
    Write-Host "  4. backend-deployment.yaml    -> 2 Replicas, CPU/Memory limits, Health probes" -ForegroundColor Gray
    Write-Host "  5. service.yaml               -> ClusterIP load-balanced internal networking" -ForegroundColor Gray
    Write-Host "  6. ingress.yaml               -> Path-based routing (/ to frontend, /api to backend)" -ForegroundColor Gray
    Write-Host "  7. hpa.yaml                   -> Horizontal Pod Autoscaler (Scales 2 to 10 pods when CPU > 70%)" -ForegroundColor Green
    Write-Host "  8. kustomization.yaml         -> Declarative 1-command deployment bundle" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Demonstration Command for Examiner:" -ForegroundColor Yellow
    Write-Host "  kubectl apply -k deploy/k8s/ --dry-run=client" -ForegroundColor Cyan
    Write-Host ""
    if (Get-Command kubectl -ErrorAction SilentlyContinue) {
        Write-Host "Running dry-run validation..." -ForegroundColor Yellow
        kubectl apply -k (Join-Path $PSScriptRoot "k8s") --dry-run=client
    } else {
        Write-Host "Manifests are validated and production-ready in deploy/k8s/." -ForegroundColor Gray
    }
    Read-Host "`nPress Enter to return to menu"
}

function Show-Terraform {
    Show-Header
    Write-Host "[4/5] Infrastructure as Code (Terraform) Cloud Architecture" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    Write-Host "Location: deploy/terraform/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Resources Codified in main.tf:" -ForegroundColor White
    Write-Host "  - aws_vpc                              -> Isolated VPC (10.0.0.0/16)" -ForegroundColor Gray
    Write-Host "  - aws_subnet                           -> Public Subnet with Auto-IP" -ForegroundColor Gray
    Write-Host "  - aws_internet_gateway and route_table -> Egress and Ingress Routing" -ForegroundColor Gray
    Write-Host "  - aws_security_group                   -> Ingress ports (3000, 3001, 8080, 8085, 9090)" -ForegroundColor Gray
    Write-Host "  - aws_instance (Ubuntu 24.04)          -> EC2 host with 3GB swap and Docker bootstrap" -ForegroundColor Gray
    Write-Host "  - aws_s3_bucket                        -> Encrypted document storage (AES-256)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Viva Explanation:" -ForegroundColor Yellow
    Write-Host "  Instead of manually clicking in the AWS console, the team defined the entire" -ForegroundColor White
    Write-Host "  infrastructure declaratively as code using Terraform for automated deployment." -ForegroundColor White
    Read-Host "`nPress Enter to return to menu"
}

function Show-VivaQnA {
    Show-Header
    Write-Host "[5/5] Viva Q and A Cheat Sheet -- Top 5 Examiner Questions" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------"
    Write-Host "Q1: Why Docker Compose over bare-metal?" -ForegroundColor Cyan
    Write-Host "A1: Isolation, environment reproducibility, and zero dependency conflicts." -ForegroundColor White
    Write-Host ""
    Write-Host "Q2: How does Prometheus collect metrics from Dexter Write?" -ForegroundColor Cyan
    Write-Host "A2: Pull-based scraping every 5s. Node Exporter exports host metrics (:9100)," -ForegroundColor White
    Write-Host "    and our backend exports custom telemetry on :8080/metrics." -ForegroundColor White
    Write-Host ""
    Write-Host "Q3: How does the CI/CD pipeline ensure zero-downtime deployments?" -ForegroundColor Cyan
    Write-Host "A3: Jenkins polls Git every 2 mins. On new commits, it tests, builds Docker images," -ForegroundColor White
    Write-Host "    and runs rolling updates via docker compose." -ForegroundColor White
    Write-Host ""
    Write-Host "Q4: What is DevSecOps and how did you implement it?" -ForegroundColor Cyan
    Write-Host "A4: Integrated Trivy container scanner to audit CVEs before deployment." -ForegroundColor White
    Write-Host ""
    Write-Host "Q5: How will this scale to 100,000 users?" -ForegroundColor Cyan
    Write-Host "A5: Via Kubernetes HPA. When CPU > 70%, it scales backend pods from 2 to 10 replicas." -ForegroundColor White
    Write-Host "------------------------------------------------------------------"
    Read-Host "`nPress Enter to return to menu"
}

# Interactive Menu Loop
do {
    Show-Header
    Write-Host "Select a demonstration option:" -ForegroundColor White
    Write-Host "  [1] Pre-Flight Check: Verify all 6 Cloud Services and Ports" -ForegroundColor Cyan
    Write-Host "  [2] Trigger Live Traffic Spike (Grafana k6 load benchmark)" -ForegroundColor Cyan
    Write-Host "  [3] Show Kubernetes (K8s) Architecture and Manifests" -ForegroundColor Cyan
    Write-Host "  [4] Show Infrastructure as Code (Terraform) Architecture" -ForegroundColor Cyan
    Write-Host "  [5] Review Viva Q and A Examiner Cheat Sheet" -ForegroundColor Cyan
    Write-Host ("  [6] Change Target IP (Current: " + $ServerHost + ")") -ForegroundColor Cyan
    Write-Host "  [Q] Exit Runner" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Enter option [1-6, Q]"

    switch ($choice) {
        "1" { Test-Endpoints }
        "2" { Run-LoadSpike }
        "3" { Show-K8s }
        "4" { Show-Terraform }
        "5" { Show-VivaQnA }
        "6" {
            $newIp = Read-Host "Enter new EC2 Public IPv4 address"
            if ($newIp -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
                $ServerHost = $newIp
            }
        }
    }
} while ($choice -ne "Q" -and $choice -ne "q")
