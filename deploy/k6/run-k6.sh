#!/bin/bash
# Dexter Write — Grafana k6 Cloud Performance Test Runner (Bash)

TARGET_HOST="${1:-http://localhost:8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo "   Dexter Write — Grafana k6 Cloud Performance Test       "
echo "=========================================================="
echo "Target: $TARGET_HOST"
echo "Simulating 25 Concurrent Virtual Users across 50 seconds..."

if command -v k6 &> /dev/null; then
    echo "[Running via native k6 binary]"
    TARGET_HOST="$TARGET_HOST" k6 run "$SCRIPT_DIR/load-test.js"
elif command -v docker &> /dev/null; then
    echo "[Running via official Docker image: grafana/k6]"
    # Map localhost if running on host against host port
    docker run --rm -i --network="host" -e "TARGET_HOST=$TARGET_HOST" grafana/k6 run - < "$SCRIPT_DIR/load-test.js"
else
    echo "[!] Neither k6 nor docker CLI found. Falling back to background curl burst..."
    for i in {1..20}; do
        (
            for j in {1..25}; do
                curl -s "$TARGET_HOST/health" > /dev/null
            done
        ) &
    done
    wait
    echo "Burst completed. Check Grafana dashboard for metrics spike!"
fi

