variable "name" {
  type        = string
  description = "Prefixo dos nomes (ex.: mini-banco-lab)."
}

variable "cidr_block" {
  type    = string
  default = "10.20.0.0/16"
}

variable "azs" {
  type        = list(string)
  description = "Duas AZs: o ALB e o subnet group do RDS exigem duas."
  validation {
    condition     = length(var.azs) == 2
    error_message = "Informe exatamente duas AZs."
  }
}
