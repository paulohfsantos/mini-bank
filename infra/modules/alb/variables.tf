variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
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

variable "target_port" {
  type    = number
  default = 3001
}
