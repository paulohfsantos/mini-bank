variable "name" {
  type = string
}

variable "repository_url" {
  type        = string
  description = "https://github.com/<owner>/<repo>"
}

variable "github_token" {
  type        = string
  sensitive   = true
  description = "Token fine-grained (só este repo, Contents: read). Usado na conexão; vai para o state."
}

variable "branch" {
  type    = string
  default = "master"
}

variable "api_url" {
  type        = string
  description = "https://<domínio do CloudFront>"
}

variable "api_key" {
  type      = string
  sensitive = true
}

variable "basic_auth_user" {
  type    = string
  default = "lab"
}
