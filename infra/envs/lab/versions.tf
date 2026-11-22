terraform {
  # use_lockfile no backend S3 exige >= 1.10; versão exata em infra/.terraform-version.
  required_version = ">= 1.17.1, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72.0" # >= 2 semanas publicado (supply chain, SEC-32); Dependabot sobe
    }
  }
}
