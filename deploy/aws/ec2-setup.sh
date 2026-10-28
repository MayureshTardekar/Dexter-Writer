#!/usr/bin/env bash
# ==============================================================================
# Dexter Write — Ubuntu EC2 Instance Bootstrap Script
# Installs Docker, Docker Compose, Git, and prepares environment
# ==============================================================================
set -euo pipefail

echo ">>> [1/5] Updating APT packages..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git apache2-utils

echo ">>> [2/5] Installing Docker Engine..."
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ">>> [3/5] Configuring Docker permissions for current user..."
sudo usermod -aG docker "$USER"

echo ">>> [4/5] Enabling and starting Docker daemon..."
sudo systemctl enable docker
sudo systemctl start docker

echo ">>> [5/5] Docker setup complete! Versions:"
docker --version
docker compose version

echo "=========================================================="
echo " EC2 Instance Ready! Please log out and log back in,"
echo " or run 'newgrp docker' to apply group permissions."
echo "=========================================================="

