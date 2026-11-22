# Segredos da aplicação no Secrets Manager (aws.md §2.2). Os valores nascem de random_password
# e ficam no state (SEC-33: bucket privado, criptografado e versionado). A senha master do RDS
# não passa por aqui: é gerenciada pelo próprio RDS (manage_master_user_password).

# Senhas dos papéis de aplicação. Sem caracteres especiais: vão para URL e para env var.
resource "random_password" "db" {
  for_each = toset(["api", "worker"])
  length   = 40
  special  = false
}

resource "random_password" "api_key" {
  length  = 48
  special = false
}

# Header secreto entre CloudFront e ALB (SEC-02).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

locals {
  db_users = { api = "mini_banco_api", worker = "mini_banco_worker" }
}

resource "aws_secretsmanager_secret" "db" {
  for_each    = local.db_users
  name        = "${var.prefix}/db-${each.key}"
  description = "Credenciais do papel ${each.value} no Postgres"
  # Só no lab: permite recriar com o mesmo nome no próximo apply.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db" {
  for_each  = local.db_users
  secret_id = aws_secretsmanager_secret.db[each.key].id
  secret_string = jsonencode({
    username = each.value
    password = random_password.db[each.key].result
  })
}

resource "aws_secretsmanager_secret" "api_key" {
  name                    = "${var.prefix}/api-key"
  description             = "API_KEYS da API (clientId:chave)"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "api_key" {
  secret_id     = aws_secretsmanager_secret.api_key.id
  secret_string = "${var.api_client_id}:${random_password.api_key.result}"
}
