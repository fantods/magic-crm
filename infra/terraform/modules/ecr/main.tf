# One repository per image built by Milestone 9:
#   apps/api/Dockerfile -> ${project}/api
#   apps/web/Dockerfile -> ${project}/web
resource "aws_ecr_repository" "api" {
  name                 = "${var.project_name}/api"
  force_delete         = true # demo stack: allow clean teardown with images present
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project_name}/web"
  force_delete         = true # demo stack: allow clean teardown with images present
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

# Keep registries from growing unbounded: expire untagged images after N days.
resource "aws_ecr_lifecycle_policy" "expire_untagged" {
  for_each = {
    api = aws_ecr_repository.api.name
    web = aws_ecr_repository.web.name
  }

  repository = each.value

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after ${var.image_tag_retention_days} days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.image_tag_retention_days
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
