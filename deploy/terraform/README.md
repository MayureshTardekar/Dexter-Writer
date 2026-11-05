# Dexter Write — Infrastructure as Code (Terraform)

This directory defines the automated AWS cloud infrastructure for **Dexter Write** using HashiCorp Terraform.

## Cloud Resources Provisioned

- **Networking:** Custom Amazon VPC (`10.0.0.0/16`), Public Subnet, Internet Gateway, and Route Tables.
- **Security:** Security Group (`dexter-write-sg`) with isolated ingress ports (22, 80, 3000, 3001, 8080, 8085, 9090, 9100).
- **Compute:** EC2 Instance (`t3.micro`, Ubuntu 24.04 LTS) with 3 GB Swap auto-provisioning and Docker engine bootstrap via `user_data`.
- **Storage:** Hardened Amazon S3 bucket with AES-256 Server-Side Encryption and Public Access Block.

## Execution Guide

### 1. Initialize Providers
```bash
cd deploy/terraform
terraform init
```

### 2. Dry-Run / Plan Verification
```bash
terraform plan
```

### 3. Apply Provisioning
```bash
terraform apply -auto-approve
```

### 4. View Outputs (Public IP & Endpoint URLs)
```bash
terraform output
```

