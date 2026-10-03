variable "project_name" {
  description = "Short project name used in resource names and tags."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "azs" {
  description = "Availability zone names to create subnets in."
  type        = list(string)
}

variable "tags" {
  description = "Extra resource tags."
  type        = map(string)
  default     = {}
}

locals {
  # One /20 per AZ per tier inside the VPC /16; deterministic spacing so
  # adding AZs later never renumbers existing subnets.
  public_subnet_cidrs  = [for i in range(length(var.azs)) : cidrsubnet(var.vpc_cidr, 4, i * 2 + 0)]
  private_subnet_cidrs = [for i in range(length(var.azs)) : cidrsubnet(var.vpc_cidr, 4, i * 2 + 1)]
}
