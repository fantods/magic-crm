variable "project_name" {
  description = "Short project name used in repository names and tags."
  type        = string
}

variable "image_tag_retention_days" {
  description = "Days an image tag can sit untagged before the lifecycle policy expires it."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Extra resource tags."
  type        = map(string)
  default     = {}
}
