# Dexter Write — Kubernetes (K8s) Orchestration Architecture

This directory contains the production-grade declarative Kubernetes manifests for orchestrating the **Dexter Write** microservices platform.

## Architecture Overview

```
                      [ Client Requests (HTTPS/HTTP) ]
                                     │
                                     ▼
                        [ Ingress Controller (Nginx) ]
                                     │
                    ┌────────────────┴────────────────┐
                    │ (Path: /)                       │ (Path: /api)
                    ▼                                 ▼
         [ Service: frontend-svc ]         [ Service: backend-svc ]
               (Port 80)                         (Port 8080)
                    │                                 │
     ┌──────────────┴──────────────┐   ┌──────────────┴──────────────┐
     ▼                             ▼   ▼                             ▼
[ Pod: frontend-1 ]  [ Pod: frontend-2 ] [ Pod: backend-1 ]  [ Pod: backend-2 ]
                                                      │
                                                      ▼
                                            [ HPA (Autoscaler) ]
                                            (Auto-scales 2 to 10 pods)
```

## Manifests Structure

| File | Resource Kind | Purpose |
| :--- | :--- | :--- |
| `namespace.yaml` | `Namespace` | Isolates workload in dedicated `dexter-prod` workspace |
| `configmap.yaml` | `ConfigMap` | Injects centralized environment variables |
| `frontend-deployment.yaml` | `Deployment` | Replicated Nginx SPA pods with RollingUpdate & probes |
| `backend-deployment.yaml` | `Deployment` | Replicated LaTeX compiler pods with CPU/RAM resource limits |
| `service.yaml` | `Service` | Internal load-balanced networking abstractions (`ClusterIP`) |
| `ingress.yaml` | `Ingress` | Edge reverse proxy & path-based routing |
| `hpa.yaml` | `HorizontalPodAutoscaler` | Autoscaler dynamically scaling backend when CPU > 70% |
| `kustomization.yaml` | `Kustomization` | Bundled 1-command deployment package |

## Deployment Commands

### 1. Dry Run Validation (Syntax & Schema Verification)
```bash
kubectl apply -k deploy/k8s/ --dry-run=client
```

### 2. Deploy to Kubernetes Cluster (EKS / Minikube / K3s)
```bash
kubectl apply -k deploy/k8s/
```

### 3. Verify Pods & Autoscaling Status
```bash
kubectl get pods,svc,hpa -n dexter-prod
```

