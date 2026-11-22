# Ovo e galinha (aws.md §4): o primeiro apply cria o bucket com state LOCAL (terraform.tfstate,
# gitignored e com o ARN das roles: SEC-33). Depois, descomente e migre:
#   terraform init -migrate-state -backend-config="bucket=mini-banco-tfstate-<account-id>"
#
# terraform {
#   backend "s3" {
#     key          = "bootstrap/terraform.tfstate"
#     region       = "us-east-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
