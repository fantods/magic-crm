output "vpc_id" {
  description = "ID of the platform VPC."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs hosting EKS nodes and RDS."
  value       = module.vpc.private_subnet_ids
}

output "ecr_api_repository_url" {
  description = "ECR repository for the API image (apps/api/Dockerfile)."
  value       = module.ecr.api_repository_url
}

output "ecr_web_repository_url" {
  description = "ECR repository for the web image (apps/web/Dockerfile)."
  value       = module.ecr.web_repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port) for DATABASE_URL."
  value       = module.rds.endpoint
}

output "rds_database_name" {
  description = "Application database name on the RDS instance."
  value       = module.rds.database_name
}

output "rds_master_password_ssm_parameter" {
  description = "SSM SecureString parameter holding the RDS master password."
  value       = module.rds.master_password_ssm_parameter_name
}

output "database_url_ssm_parameter" {
  description = "SSM SecureString parameter holding the full postgres connection string (DATABASE_URL)."
  value       = module.rds.database_url_ssm_parameter_name
}

output "eks_cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API server endpoint."
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_certificate_authority_data" {
  description = "Base64 CA certificate for the EKS cluster (for kubeconfig)."
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "eks_cluster_version" {
  description = "Kubernetes version the cluster was created with."
  value       = module.eks.cluster_version
}

output "eks_oidc_provider_arn" {
  description = "OIDC provider ARN for IRSA workload roles (Milestone 11+)."
  value       = module.eks.oidc_provider_arn
}

output "eks_node_role_arn" {
  description = "IAM role assumed by the managed node group."
  value       = module.eks.node_role_arn
}
