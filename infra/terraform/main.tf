data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

# Network: VPC with public + private subnets and a single NAT gateway.
module "vpc" {
  source = "./modules/vpc"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
  azs          = local.azs
  tags         = var.tags
}

# Container image registries for the two images built by Milestone 9.
module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  tags         = var.tags
}

# Managed PostgreSQL 16 for the application.
module "rds" {
  source = "./modules/rds"

  project_name             = var.project_name
  db_name                  = var.db_name
  db_username              = var.db_username
  db_instance_class        = var.db_instance_class
  db_allocated_storage     = var.db_allocated_storage
  db_max_allocated_storage = var.db_max_allocated_storage
  db_engine_version        = var.db_engine_version
  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnet_ids
  # Pods egress through the node security group with the default VPC CNI.
  allowed_security_group_ids = [module.eks.node_security_group_id]
  tags                       = var.tags
}

# Kubernetes cluster that will host the containers (consumed by Milestone 11).
module "eks" {
  source = "./modules/eks"

  project_name                         = var.project_name
  vpc_id                               = module.vpc.vpc_id
  subnet_ids                           = module.vpc.private_subnet_ids
  kubernetes_version                   = var.kubernetes_version
  node_instance_types                  = var.node_instance_types
  node_capacity_type                   = var.node_capacity_type
  node_min_size                        = var.node_min_size
  node_max_size                        = var.node_max_size
  node_desired_size                    = var.node_desired_size
  cluster_endpoint_public_access_cidrs = var.cluster_endpoint_public_access_cidrs
  tags                                 = var.tags
}
