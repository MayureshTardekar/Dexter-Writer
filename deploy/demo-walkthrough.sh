#!/bin/bash
# ==============================================================================
# Dexter Write — Live Evaluation Demo & Architecture Walkthrough (Bash)
# For: Mayuresh Tardekar, Sanika Sonavane, Ritik Bahurashi
# Course: Cloud Computing on Linux Lab Evaluation
# ==============================================================================

SERVER_HOST="${1:-3.108.58.191}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_header() {
    clear
    echo "=================================================================="
    echo "   DEXTER WRITE — CLOUD COMPUTING LIVE EVALUATION RUNNER          "
    echo "   Authors: Mayuresh Tardekar | Sanika Sonavane | Ritik Bahurashi "
    echo "=================================================================="
    echo "Target Cloud Host: http://$SERVER_HOST"
    echo ""
}

test_endpoints() {
    show_header
    echo "[1/5] Verifying Cloud Microservices Status..."
    echo "------------------------------------------------------------------"

    declare -A endpoints=(
        ["Frontend Web IDE"]="3000:/"
        ["Backend Compiler API"]="8080:/health"
        ["Backend Prometheus Metrics"]="8080:/metrics"
        ["Prometheus Scraper"]="9090:/targets"
        ["Grafana NOC Dashboard"]="3001:/login"
        ["Jenkins CI/CD Automation"]="8085:/login"
    )

    for name in "${!endpoints[@]}"; do
        info="${endpoints[$name]}"
        port="${info%%:*}"
        path="${info#*:}"
        url="http://$SERVER_HOST:$port$path"

        printf "Checking %-30s -> %-36s ... " "$name" "$url"
        status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 4 "$url" 2>/dev/null || echo "000")
        if [ "$status" = "200" ]; then
            echo -e "\033[0;32m[  OK 200  ]\033[0m"
        elif [ "$status" != "000" ]; then
            echo -e "\033[0;33m[ HTTP $status ]\033[0m"
        else
            echo -e "\033[0;31m[ OFFLINE ]\033[0m"
        fi
    done
    echo "------------------------------------------------------------------"
    read -p "Press Enter to return to menu"
}

run_load_spike() {
    show_header
    echo "[2/5] Running Automated Traffic Burst to Spike Grafana Metrics..."
    echo "Target Backend: http://$SERVER_HOST:8080"
    echo "Simulating 25 Concurrent Users generating 1,000+ API requests..."
    echo "Look at Grafana Dashboard (http://$SERVER_HOST:3001) in real-time!"
    echo ""

    "$SCRIPT_DIR/k6/run-k6.sh" "http://$SERVER_HOST:8080"

    echo ""
    echo "Success! Open Grafana (http://$SERVER_HOST:3001) to show the live spike."
    read -p "Press Enter to return to menu"
}

show_k8s() {
    show_header
    echo "[3/5] Kubernetes (K8s) Production Architecture & Manifests"
    echo "------------------------------------------------------------------"
    echo "Location: deploy/k8s/"
    echo ""
    echo "Manifests:"
    echo "  1. namespace.yaml             -> Dedicated 'dexter-prod' isolation"
    echo "  2. configmap.yaml             -> Decoupled production runtime config"
    echo "  3. frontend-deployment.yaml   -> 2 Replicas, RollingUpdate, Liveness probes"
    echo "  4. backend-deployment.yaml    -> 2 Replicas, CPU/Memory limits, Health probes"
    echo "  5. service.yaml               -> ClusterIP load-balanced internal networking"
    echo "  6. ingress.yaml               -> Path-based routing (/ to frontend, /api to backend)"
    echo "  7. hpa.yaml                   -> Horizontal Pod Autoscaler (Scales 2 to 10 pods when CPU > 70%)"
    echo "  8. kustomization.yaml         -> Declarative 1-command deployment bundle"
    echo ""
    echo "Validation Command:"
    echo "  kubectl apply -k deploy/k8s/ --dry-run=client"
    echo ""
    read -p "Press Enter to return to menu"
}

show_terraform() {
    show_header
    echo "[4/5] Infrastructure as Code (Terraform) Cloud Architecture"
    echo "------------------------------------------------------------------"
    echo "Location: deploy/terraform/"
    echo ""
    echo "Resources Codified in main.tf:"
    echo "  - aws_vpc                              -> Isolated VPC (10.0.0.0/16)"
    echo "  - aws_subnet                           -> Public Subnet with Auto-IP"
    echo "  - aws_internet_gateway & route_table   -> Egress & Ingress Routing"
    echo "  - aws_security_group                   -> Ingress rules (3000, 3001, 8080, 8085, 9090)"
    echo "  - aws_instance (Ubuntu 24.04)          -> EC2 host with 3GB swap & Docker bootstrap"
    echo "  - aws_s3_bucket                        -> Encrypted document storage (AES-256)"
    echo ""
    read -p "Press Enter to return to menu"
}

show_viva_qna() {
    show_header
    echo "[5/5] Viva Q&A Cheat Sheet — Top Examiner Questions"
    echo "------------------------------------------------------------------"
    echo "Q1: Why Docker Compose over bare-metal?"
    echo "A1: Environment reproducibility, container isolation, and resource bounds."
    echo ""
    echo "Q2: How does Prometheus collect metrics?"
    echo "A2: Pull-based model scraping Node Exporter (:9100) and Backend (:8080/metrics) every 5s."
    echo ""
    echo "Q3: How does CI/CD pipeline ensure zero downtime?"
    echo "A3: Jenkins triggers rolling container rebuilds (docker compose up -d) upon git push."
    echo ""
    echo "Q4: What is DevSecOps and how did you implement it?"
    echo "A4: Automated Trivy vulnerability scans audit container CVEs before deployment."
    echo ""
    echo "Q5: How does the system scale under load?"
    echo "A5: Kubernetes HPA dynamically scales compiler pods from 2 to 10 when CPU exceeds 70%."
    echo "------------------------------------------------------------------"
    read -p "Press Enter to return to menu"
}

while true; do
    show_header
    echo "Select an option:"
    echo "  [1] Pre-Flight Check: Verify all 6 Cloud Services & Ports"
    echo "  [2] Trigger Live Traffic Spike (Grafana k6 load benchmark)"
    echo "  [3] Show Kubernetes (K8s) Architecture & Manifests"
    echo "  [4] Show Infrastructure as Code (Terraform) Architecture"
    echo "  [5] Review Viva Q&A & Examiner Cheat Sheet"
    echo "  [6] Change Target IP (Current: $SERVER_HOST)"
    echo "  [Q] Exit Runner"
    echo ""
    read -p "Enter choice [1-6, Q]: " choice
    case "$choice" in
        1) test_endpoints ;;
        2) run_load_spike ;;
        3) show_k8s ;;
        4) show_terraform ;;
        5) show_viva_qna ;;
        6) read -p "Enter new EC2 Public IP: " SERVER_HOST ;;
        [Qq]) exit 0 ;;
        *) echo "Invalid option" ;;
    esac
done

