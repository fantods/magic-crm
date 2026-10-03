# Root configuration for the Formless AWS platform substrate.
#
# State lives locally by default for the demo. For a real deployment,
# switch to the S3 backend below (documented in README.md, "Remote state").

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Remote state (documented default for anything beyond the demo):
  #
  # backend "s3" {
  #   bucket         = "formless-tfstate-<account-id>" # must be globally unique
  #   key            = "platform/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "formless-tfstate-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
