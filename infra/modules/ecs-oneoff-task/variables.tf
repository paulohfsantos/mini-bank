variable "prefix" {
  type = string
}

variable "name" {
  type = string
}

variable "image" {
  type = string
}

variable "ecr_repository_arn" {
  type = string
}

variable "command" {
  type = list(string)
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type    = map(string)
  default = {}
}

variable "secret_arns" {
  type = list(string)
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "log_retention_days" {
  type    = number
  default = 3
}
