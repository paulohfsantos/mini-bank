variable "region" {
  type    = string
  default = "us-east-1" # ADR-0017
}

variable "azs" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "image_tag" {
  type        = string
  description = "Tag (git sha) das imagens no ECR: scripts/latest-image-tag.sh."
  validation {
    condition     = can(regex("^[0-9a-f]{7,40}$", var.image_tag))
    error_message = "Use o git sha da imagem (tags são IMMUTABLE no ECR)."
  }
}

variable "desired_count" {
  type        = number
  description = <<-EOT
    Tasks por service (api e worker). Sem padrão de propósito: no primeiro apply da sessão os
    papéis do banco ainda não têm LOGIN, então os services nascem com 0, a migration roda e só
    depois sobem para 1 (scripts/lab.sh up faz a sequência).
  EOT
  validation {
    condition     = contains([0, 1, 2], var.desired_count)
    error_message = "Use 0 (antes da migration), 1 ou 2."
  }
}

variable "alarm_email" {
  type        = string
  description = "Destino dos alarmes. Fora do git: TF_VAR_alarm_email."
}

variable "github_repository_url" {
  type        = string
  description = "Repositório que o Amplify compila."
}

variable "github_token" {
  type        = string
  sensitive   = true
  default     = null
  description = "Token fine-grained para o Amplify (TF_VAR_github_token, só no apply). null = sem front."
}

variable "enable_execute_command" {
  type        = bool
  default     = false
  description = "ECS Exec para troubleshooting (SEC-34). Ligar só durante a investigação."
}

variable "adot_image" {
  type    = string
  default = "public.ecr.aws/aws-observability/aws-otel-collector:v0.51.0"
}
