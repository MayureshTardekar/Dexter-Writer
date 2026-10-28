#!/usr/bin/env bash
# ==============================================================================
# Dexter Write — College Lab Load Test Script (ab / curl loop)
# Generates traffic to show live metric spikes on the Grafana dashboard
# ==============================================================================
set -euo pipefail

TARGET_HOST="${1:-http://localhost:8080}"
DURATION_SEC="${2:-30}"
CONCURRENCY="${3:-10}"

echo "=========================================================="
echo " Starting Dexter Write Load Test against: ${TARGET_HOST}"
echo " Duration: ${DURATION_SEC}s | Concurrency: ${CONCURRENCY}"
echo " Check Grafana Dashboard at: http://localhost:3001"
echo "=========================================================="

if command -v ab >/dev/null 2>&1; then
    echo "Running Apache Benchmark (ab)..."
    ab -n 1000 -c "${CONCURRENCY}" "${TARGET_HOST}/health"
else
    echo "Running multi-threaded curl traffic loop..."
    END_TIME=$((SECONDS + DURATION_SEC))

    for i in $(seq 1 "${CONCURRENCY}"); do
        (
            while [ $SECONDS -lt $END_TIME ]; do
                # 1. Hit health endpoint (200 OK)
                curl -s -o /dev/null "${TARGET_HOST}/health"
                # 2. Hit metrics endpoint (200 OK)
                curl -s -o /dev/null "${TARGET_HOST}/metrics"
                # 3. Hit an intentional 404 to demonstrate error panel
                curl -s -o /dev/null "${TARGET_HOST}/invalid-route-demo"
            done
        ) &
    done

    wait
fi

echo "=========================================================="
echo " Load test complete! Verify spikes on your Grafana panels:"
echo " 1. CPU Utilization (%)"
echo " 2. Memory Usage"
echo " 3. Disk I/O"
echo " 4. Network Traffic (Rx/Tx)"
echo " 5. Backend Request Rate & Error Rate"
echo "=========================================================="

