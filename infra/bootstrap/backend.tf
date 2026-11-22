# State do bootstrap no próprio bucket que ele cria (ADR-0015). Configuração parcial: o nome do
# bucket tem o account id e entra no init. Ovo e galinha: na 1ª vez `scripts/lab.sh bootstrap`
# cria um override.tf temporário com backend local, aplica e migra o state para cá.
terraform {
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
