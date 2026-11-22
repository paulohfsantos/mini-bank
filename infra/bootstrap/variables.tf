variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_owner" {
  type = string
}

variable "github_repo" {
  type = string
}

variable "budget_email" {
  type        = string
  description = "Alertas de custo. Fora do git: TF_VAR_budget_email."
}

variable "monthly_budget_usd" {
  type    = number
  default = 15
}
