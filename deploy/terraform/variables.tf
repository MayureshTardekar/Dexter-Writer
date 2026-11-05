variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "EC2 instance sizing"
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "AWS SSH Key Pair name"
  type        = string
  default     = "Key1"
}

variable "project_name" {
  description = "Project name tag"
  type        = string
  default     = "dexter-write"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "s3_bucket_name" {
  description = "Unique S3 bucket name for document persistence"
  type        = string
  default     = "dexter-write-storage-cloud"
}

