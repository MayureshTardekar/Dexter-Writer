terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# 1. Virtual Private Cloud (VPC)
resource "aws_vpc" "dexter_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

# 2. Internet Gateway
resource "aws_internet_gateway" "dexter_igw" {
  vpc_id = aws_vpc.dexter_vpc.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

# 3. Public Subnet
resource "aws_subnet" "dexter_public_subnet" {
  vpc_id                  = aws_vpc.dexter_vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"

  tags = {
    Name = "${var.project_name}-public-subnet"
  }
}

# 4. Route Table & Association
resource "aws_route_table" "dexter_public_rt" {
  vpc_id = aws_vpc.dexter_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.dexter_igw.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "dexter_public_assoc" {
  subnet_id      = aws_subnet.dexter_public_subnet.id
  route_table_id = aws_route_table.dexter_public_rt.id
}

# 5. Security Group
resource "aws_security_group" "dexter_sg" {
  name        = "${var.project_name}-sg"
  description = "Security group for Dexter Write cloud microservices"
  vpc_id      = aws_vpc.dexter_vpc.id

  # Ingress rules for application and telemetry
  dynamic "ingress" {
    for_each = [
      { port = 22,   desc = "SSH Remote Access" },
      { port = 80,   desc = "Standard HTTP" },
      { port = 3000, desc = "Dexter Frontend Web IDE" },
      { port = 3001, desc = "Grafana Observability Dashboard" },
      { port = 8080, desc = "Dexter Backend Compiler & Metrics" },
      { port = 8085, desc = "Jenkins CI/CD Server" },
      { port = 9090, desc = "Prometheus Time Series Metrics" },
      { port = 9100, desc = "Node Exporter Host Metrics" }
    ]
    content {
      description = ingress.value.desc
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-sg"
  }
}

# 6. Ubuntu 24.04 LTS AMI Lookup
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# 7. EC2 Instance Host
resource "aws_instance" "dexter_host" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  key_name                    = var.key_name
  subnet_id                   = aws_subnet.dexter_public_subnet.id
  vpc_security_group_ids      = [aws_security_group.dexter_sg.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 25
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = <<-EOF
              #!/bin/bash
              set -e
              # System update
              apt-get update -y && apt-get upgrade -y
              
              # Swap allocation (prevents OOM on t3.micro)
              fallocate -l 3G /swapfile
              chmod 600 /swapfile
              mkswap /swapfile
              swapon /swapfile
              echo '/swapfile none swap sw 0 0' >> /etc/fstab

              # Install Docker and Compose plugin
              apt-get install -y ca-certificates curl gnupg
              install -m 0755 -d /etc/apt/keyrings
              curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
              chmod a+r /etc/apt/keyrings/docker.gpg
              echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
              apt-get update -y
              apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
              usermod -aG docker ubuntu
              systemctl enable --now docker
              EOF

  tags = {
    Name = "${var.project_name}-cloud-host"
  }
}

# 8. S3 Storage Bucket with Least-Privilege Hardening
resource "aws_s3_bucket" "dexter_storage" {
  bucket        = var.s3_bucket_name
  force_destroy = false

  tags = {
    Name = "${var.project_name}-storage"
  }
}

resource "aws_s3_bucket_public_access_block" "dexter_s3_security" {
  bucket = aws_s3_bucket.dexter_storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dexter_s3_encryption" {
  bucket = aws_s3_bucket.dexter_storage.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

