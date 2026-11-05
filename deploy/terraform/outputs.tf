output "ec2_instance_id" {
  description = "Provisioned EC2 Instance ID"
  value       = aws_instance.dexter_host.id
}

output "ec2_public_ip" {
  description = "Public IPv4 address of cloud host"
  value       = aws_instance.dexter_host.public_ip
}

output "web_ide_url" {
  description = "Dexter Write Frontend IDE URL"
  value       = "http://${aws_instance.dexter_host.public_ip}:3000"
}

output "backend_health_url" {
  description = "Backend Compiler Healthcheck Endpoint"
  value       = "http://${aws_instance.dexter_host.public_ip}:8080/health"
}

output "grafana_dashboard_url" {
  description = "Grafana NOC Telemetry Dashboard URL"
  value       = "http://${aws_instance.dexter_host.public_ip}:3001"
}

output "jenkins_pipeline_url" {
  description = "Jenkins Automated CI/CD Server URL"
  value       = "http://${aws_instance.dexter_host.public_ip}:8085"
}

output "prometheus_targets_url" {
  description = "Prometheus Scrape Targets URL"
  value       = "http://${aws_instance.dexter_host.public_ip}:9090/targets"
}

output "s3_bucket_arn" {
  description = "ARN of dedicated S3 document bucket"
  value       = aws_s3_bucket.dexter_storage.arn
}

