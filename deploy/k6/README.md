# Dexter Write — Performance Engineering with Grafana k6

This directory contains automated stress testing and latency benchmarking scripts using **Grafana k6**.

## Test Highlights

- **Virtual Users (VUs):** Ramps up from 10 to 25 concurrent users.
- **Microservices Tested:**
  - `GET /health` (Availability & uptime SLA)
  - `POST /compile` (LaTeX rendering throughput & duration under load)
- **Threshold SLAs:**
  - 95th Percentile Latency ($p95$) $< 500\text{ ms}$
  - HTTP Failure Rate $< 5\%$
- **Telemetry Integration:** Telemetry data generates live spikes on Prometheus (`node_cpu_seconds_total`, `dexter_http_requests_total`) and Grafana panels.

## Running the Benchmark

### Option A: Via PowerShell (Windows)
```powershell
.\deploy\k6\run-k6.ps1 -TargetHost "http://<EC2-OR-LOCAL-IP>:8080"
```

### Option B: Via Bash (Linux / EC2)
```bash
chmod +x ./deploy/k6/run-k6.sh
./deploy/k6/run-k6.sh "http://localhost:8080"
```

### Option C: Via Official Docker Image (Zero Installation Needed)
```bash
docker run --rm -i -e TARGET_HOST="http://localhost:8080" grafana/k6 run - < deploy/k6/load-test.js
```

