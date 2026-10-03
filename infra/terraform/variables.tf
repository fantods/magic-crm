variable "project_name" {
  description = "Short project name used to prefix resource names and tags."
  type        = string
  default     = "formless"
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets across (2 minimum for RDS/EKS)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2
    error_message = "At least 2 availability zones are required for RDS subnet groups and EKS."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. Leave null to let AWS pick the current default version for new clusters at creation time."
  type        = string
  default     = null
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "Node group capacity type: ON_DEMAND or SPOT."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type must be ON_DEMAND or SPOT."
  }
}

variable "node_min_size" {
  description = "Minimum number of worker nodes."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum number of worker nodes."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 1
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the EKS API endpoint from the internet. Restrict these to your office/VPN ranges for anything real."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "db_name" {
  description = "Name of the application database on the RDS instance."
  type        = string
  default     = "formless"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "formless"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage in gibibytes (gp3, autoscaled up to db_max_allocated_storage)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Upper bound for RDS storage autoscaling, in gibibytes."
  type        = number
  default     = 100
}

variable "db_engine_version" {
  description = "PostgreSQL engine version on RDS (matches the app's PostgreSQL 16 requirement; minor upgrades are automatic)."
  type        = string
  default     = "16.9"
}

variable "tags" {
  description = "Extra tags merged into every resource's default tags."
  type        = map(string)
  default     = {}
}
