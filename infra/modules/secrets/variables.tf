variable "prefix" {
  type        = string
  description = "Prefixo dos nomes, ex.: mini-banco/lab"
}

variable "api_client_id" {
  type        = string
  default     = "web"
  description = "clientId da chave usada pelo front (API_KEYS = clientId:chave)."
}
