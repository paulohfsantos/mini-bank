variable "name" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

variable "origin_verify_header" {
  type    = string
  default = "X-Origin-Verify"
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
}
