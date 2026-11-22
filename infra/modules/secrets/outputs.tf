output "db_secret_arns" {
  description = "ARN por papel: { api, worker }."
  value       = { for k, s in aws_secretsmanager_secret.db : k => s.arn }
}

output "api_key_secret_arn" {
  value = aws_secretsmanager_secret.api_key.arn
}

output "web_api_key" {
  description = "Chave que o front envia (vai para o Amplify; débito SEC-28)."
  value       = random_password.api_key.result
  sensitive   = true
}

output "origin_verify_secret" {
  value     = random_password.origin_verify.result
  sensitive = true
}
