variable "prefix" {
  type        = string
  description = "Ex.: mini-banco-lab (nomes de roles, logs, family)."
}

variable "name" {
  type        = string
  description = "Nome do service e do container da app (api, worker)."
}

variable "cluster_arn" {
  type = string
}

variable "image" {
  type        = string
  description = "Imagem completa com tag (<repo>:<git sha>)."
}

variable "ecr_repository_arn" {
  type = string
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type        = number
  default     = 1024
  description = "Memória da task (MiB), dividida entre app e sidecar."
}

variable "app_memory" {
  type        = number
  default     = 768
  description = "Limite rígido do container da app; o heap do Node fica em ~60% disso (PERF-21)."
}

variable "container_port" {
  type    = number
  default = null
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type        = map(string)
  default     = {}
  description = "Env var → valueFrom (ARN do secret, opcionalmente com :chave-json::)."
}

variable "secret_arns" {
  type        = list(string)
  default     = []
  description = "ARNs dos secrets que a execution role pode ler (injeção no start)."
}

variable "task_policy_json" {
  type        = string
  description = "Permissões do código da app e do sidecar (task role)."
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "target_group_arn" {
  type    = string
  default = null
}

variable "health_check_command" {
  type        = list(string)
  description = "healthCheck do container (CMD-SHELL ...)."
}

variable "stop_timeout" {
  type        = number
  default     = 30
  description = "Segundos entre SIGTERM e SIGKILL (PERF-19, PERF-22)."
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "enable_execute_command" {
  type        = bool
  default     = false
  description = "ECS Exec (SEC-34): desligado por padrão; quem tem o shell lê env vars com segredos."
}

variable "adot" {
  type = object({
    image  = string
    config = string
    memory = optional(number, 256)
  })
  default     = null
  description = "Sidecar ADOT (OTLP → X-Ray, Prometheus → EMF). null = sem sidecar."
}

variable "log_retention_days" {
  type    = number
  default = 3
}
