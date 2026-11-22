variable "prefix" {
  type = string
}

variable "alarm_email" {
  type        = string
  description = "Recebe os alarmes (confirmar a assinatura no e-mail após cada apply)."
}

variable "db_instance_identifier" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 3
}
