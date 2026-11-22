variable "name" {
  type        = string
  description = "Nome da fila principal (a DLQ recebe o sufixo -dlq)."
}

variable "max_receive_count" {
  type    = number
  default = 5
}
