output "endpoint" {
  description = "RDS endpoint as host:port."
  value       = aws_db_instance.postgres.endpoint
}

output "database_name" {
  description = "Initial database name."
  value       = aws_db_instance.postgres.db_name
}

output "master_password_ssm_parameter_name" {
  description = "SSM parameter holding the master password."
  value       = aws_ssm_parameter.master_password.name
}

output "database_url_ssm_parameter_name" {
  description = "SSM parameter holding the full DATABASE_URL string."
  value       = aws_ssm_parameter.database_url.name
}

output "security_group_id" {
  description = "Security group attached to the RDS instance."
  value       = aws_security_group.postgres.id
}
