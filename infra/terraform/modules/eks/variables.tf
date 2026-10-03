variable "project_name" {
  description = "Short project name used in resource names and tags."
  type        = string
}

variable "vpc_id" {
  description = "VPC hosting the cluster."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the cluster and the managed node group."
  type        = list(string)
}

variable "kubernetes_version" {
  description = "Kubernetes version. Null lets AWS pick the current default version for new clusters."
  type        = string
  default     = null
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group."
  type        = list(string)
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT."
  type        = string
}

variable "node_min_size" {
  description = "Minimum node count."
  type        = number
}

variable "node_max_size" {
  description = "Maximum node count."
  type        = number
}

variable "node_desired_size" {
  description = "Desired node count."
  type        = number
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the public EKS API endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "tags" {
  description = "Extra resource tags."
  type        = map(string)
  default     = {}
}
