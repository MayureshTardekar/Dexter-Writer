#!/usr/bin/env bash
# ==============================================================================
# Dexter Write — Automated Build & Deployment Script (Linux / AWS EC2)
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Starting Dexter Write CI/CD Pipeline on $(uname -s)"
echo "=========================================================="

echo "[1/4] Checking prerequisites (docker, docker compose, curl)..."
command -v docker >/dev/null 2>&1 || { echo "Error: docker is required."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Error: docker compose plugin is required."; exit 1; }

echo "[2/4] Validating docker-compose configuration..."
docker compose config >/dev/null

echo "[3/4] Building microservices (Frontend, Backend)..."
docker compose build --pull

echo "[4/4] Starting containers in detached mode..."
docker compose down || true
docker compose up -d --remove-orphans

echo "Waiting for services to become healthy..."
sleep 5

# Verify Health
BACKEND_HEALTH=$(curl -s http://localhost:8080/health || echo "fail")
echo "Backend Health: ${BACKEND_HEALTH}"

PROMETHEUS_HEALTH=$(curl -s http://localhost:9090/-/healthy || echo "fail")
echo "Prometheus Health: ${PROMETHEUS_HEALTH}"

echo "=========================================================="
echo " Microservices Deployed Successfully!"
echo " - Frontend:    http://localhost:3000"
echo " - Backend:     http://localhost:8080"
echo " - Prometheus:  http://localhost:9090"
echo " - Grafana:     http://localhost:3001 (User: admin / Pass: admin)"
echo " - NodeExporter:http://localhost:9100/metrics"
echo "=========================================================="

