# Dexter Write — Cloud-Native Collaborative Document Engineering Platform
## Cloud Computing on Linux — Lab Project Documentation

**Project Title:** Dexter Write: A Cloud-Native Collaborative Document Engineering Platform  
**Team Members:** Mayuresh Tardekar, Sanika Sonavane, Ritik Bahurashi  
**Branch:** `Dexter-CC`

---

## 1. System Architecture & Flow

```
[ Developer ]
      │
      ▼ (Git Push)
[ GitHub / Jenkins CI/CD ]
      │ (Build & Test Docker Images)
      ▼
[ AWS EC2 (Ubuntu Linux) ]
      │
      ├─► [ Nginx (Reverse Proxy :80/:3000) ]
      │         │
      │         ├─► [ React / Vite SPA Frontend ]
      │         └─► [ Node.js Backend Container (:8080) ]
      │
      ├─► [ Node Exporter (:9100) ] ──┐
      │                               │ (Scrapes Host Metrics)
      ├─► [ Backend Metrics (:8080) ] ─┴─► [ Prometheus (:9090) ]
      │                                           │ (Visualizes 5 Panels)
      │                                           ▼
      └─► [ Amazon S3 + IAM ]             [ Grafana (:3001) ]
          (Frontend & Export Storage)
```

---

## 2. Technology Mapping (As per Abstract)

| No. | Technology | Role in Project | Verification Endpoint |
|---|---|---|---|
| 1 | **Prometheus** (Compulsory) | Collects system and container telemetry | `http://<EC2-IP>:9090` |
| 2 | **Grafana** (Compulsory) | Visualizes 5-panel real-time dashboard | `http://<EC2-IP>:3001` (`admin`/`admin`) |
| 3 | **AWS EC2 (Ubuntu)** | Hosts Linux environment and Docker containers | SSH / Public IP |
| 4 | **Docker** | Multi-container microservices via Compose | `docker compose ps` |
| 5 | **Nginx** | Reverse proxy routing `/api/*` to Node backend | Port 80 / 3000 |
| 6 | **Node Exporter** | Host CPU, RAM, Disk, and Network metrics | `http://<EC2-IP>:9100/metrics` |
| 7 | **Jenkins / CI-CD** | Automated build, test, and container deployment | `deploy/ci-cd/Jenkinsfile` & `deploy.sh` |
| 8 | **Amazon S3 + IAM** | Static assets and document export storage | `deploy/aws/s3-iam-policy.json` |

---

## 3. Grafana 5-Panel Monitoring Plan

The Grafana dashboard is pre-provisioned automatically at `http://localhost:3001` (or your EC2 IP) under the title:
**`Dexter Write — Cloud Native System & App Telemetry`**

1. **Panel 1: Host CPU Utilization (%)**
   - PromQL: `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`
2. **Panel 2: Host Memory Usage**
   - PromQL: `node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes` vs `node_memory_MemTotal_bytes`
3. **Panel 3: Disk I/O Rate**
   - PromQL: `sum(rate(node_disk_read_bytes_total[1m]))` and `sum(rate(node_disk_written_bytes_total[1m]))`
4. **Panel 4: Network Throughput (Rx / Tx)**
   - PromQL: `sum(rate(node_network_receive_bytes_total[1m]))` and `sum(rate(node_network_transmit_bytes_total[1m]))`
5. **Panel 5: Backend Request Rate & Errors**
   - PromQL: `rate(dexter_http_requests_total{status="all"}[1m])` vs `rate(dexter_http_requests_total{status="2xx"}[1m])` vs errors (`4xx` + `5xx`)

---

## 4. How to Run Locally (Docker)

To start the complete multi-container stack:
```bash
docker compose up -d --build
```

Check running containers:
```bash
docker compose ps
```

Access services:
- **Frontend App:** http://localhost:3000
- **Node Backend Health:** http://localhost:8080/health
- **Backend Prometheus Metrics:** http://localhost:8080/metrics
- **Prometheus UI:** http://localhost:9090 (Check `Status -> Targets` to see all endpoints UP)
- **Grafana Dashboard:** http://localhost:3001 (User: `admin`, Password: `admin`)

---

## 5. Live Demonstration & Load Test

During your viva/lab demo, run the load test script in a separate terminal:

**On Linux / EC2:**
```bash
chmod +x deploy/load-test.sh
./deploy/load-test.sh http://localhost:8080 30 10
```

**On Windows (PowerShell):**
```powershell
.\deploy\load-test.ps1 -TargetHost "http://localhost:8080" -TotalRequests 300
```

Watch the Grafana graphs at `http://localhost:3001` immediately spike and respond in real-time!

---

## 6. How to Deploy on AWS EC2 (Ubuntu)

1. Launch an **Ubuntu 22.04 / 24.04 EC2 instance** (`t2.micro` or `t2.small` / `t3.small`).
2. Configure Security Group Inbound Rules:
   - Port 22 (SSH)
   - Port 80 / 3000 (Frontend / Nginx)
   - Port 8080 (Node.js Backend)
   - Port 9090 (Prometheus)
   - Port 3001 (Grafana)
3. SSH into the instance:
   ```bash
   ssh -i your-key.pem ubuntu@<ec2-public-ip>
   ```
4. Clone the repository and switch to `Dexter-CC`:
   ```bash
   git clone <repo-url>
   cd "Dexter write"
   git checkout Dexter-CC
   ```
5. Run the bootstrap script:
   ```bash
   chmod +x deploy/aws/ec2-setup.sh
   ./deploy/aws/ec2-setup.sh
   ```
6. Start the stack:
   ```bash
   docker compose up -d --build
   ```

