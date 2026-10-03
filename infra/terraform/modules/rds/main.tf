# The master password is generated, never hardcoded. 32 alphanumeric
# characters avoids URL-encoding pitfalls when it is embedded in DATABASE_URL.
resource "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name_prefix = "${var.project_name}-db-"
  subnet_ids  = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.project_name}-db-subnets"
  })
}

resource "aws_security_group" "postgres" {
  name_prefix            = "${var.project_name}-postgres-"
  description            = "PostgreSQL access from the EKS node group"
  vpc_id                 = var.vpc_id
  revoke_rules_on_delete = true

  ingress {
    description     = "PostgreSQL from EKS nodes/pods"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "All outbound (certificate checks, etc.)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-postgres"
  })
}

resource "aws_db_instance" "postgres" {
  identifier_prefix = "${var.project_name}-"
  engine            = "postgres"
  engine_version    = var.db_engine_version
  instance_class    = var.db_instance_class
  db_name           = var.db_name
  username          = var.db_username
  password          = random_password.master.result
  port              = 5432

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  publicly_accessible    = false
  multi_az               = false # demo sizing; flip to true for resilience

  auto_minor_version_upgrade = true
  backup_retention_period    = var.backup_retention_days
  backup_window              = "06:00-07:00"
  maintenance_window         = "sun:07:30-sun:08:30"
  copy_tags_to_snapshot      = true
  deletion_protection        = false # demo stack; enable for anything persistent
  skip_final_snapshot        = true  # demo stack; a final snapshot is safer for real data
  apply_immediately          = false

  tags = merge(var.tags, {
    Name = "${var.project_name}-postgres"
  })
}

# Secrets land in SSM Parameter Store (standard tier: free). The values are
# sensitive; note that Terraform state still contains them, so the remote
# state bucket must be encrypted and access-controlled (README "Remote state").
resource "aws_ssm_parameter" "master_password" {
  name        = "/${var.project_name}/prod/rds-master-password"
  description = "Master password for the ${var.project_name} RDS PostgreSQL instance."
  type        = "SecureString"
  value       = random_password.master.result

  tags = var.tags
}

resource "aws_ssm_parameter" "database_url" {
  name        = "/${var.project_name}/prod/database-url"
  description = "DATABASE_URL connection string for the ${var.project_name} API."
  type        = "SecureString"
  value       = "postgresql://${var.db_username}:${random_password.master.result}@${aws_db_instance.postgres.endpoint}/${var.db_name}"

  tags = var.tags
}
