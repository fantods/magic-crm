variable "project_name" {
  description = "Short project name used in resource names and tags."
  type        = string
}

variable "db_name" {
  description = "Initial database name."
  type        = string
}

variable "db_username" {
  description = "Master username."
  type        = string
}

variable "db_engine_version" {
  description = "PostgreSQL engine version."
  type        = string
}

variable "db_instance_class" {
  description = "Instance class for the RDS instance."
  type        = string
}

variable "db_allocated_storage" {
  description = "Initial storage in gibibytes."
  type        = number
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling upper bound in gibibytes."
  type        = number
}

variable "vpc_id" {
  description = "VPC hosting the database."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to reach PostgreSQL on 5432 (the EKS node group SG)."
  type        = list(string)
}

variable "backup_retention_days" {
  description = "Automated backup retention in days."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Extra resource tags."
  type        = map(string)
  default     = {}
}
