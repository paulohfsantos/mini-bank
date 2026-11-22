# State remoto no bucket do bootstrap, lock pelo próprio S3 (ADR-0015). O nome do bucket tem o
# account id, então entra no init (configuração parcial), não no git:
#   terraform init -backend-config="bucket=mini-banco-tfstate-<account-id>"
terraform {
  backend "s3" {
    key          = "envs/lab/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
