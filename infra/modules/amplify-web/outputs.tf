output "app_id" {
  value = aws_amplify_app.this.id
}

output "url" {
  value = "https://${var.branch}.${aws_amplify_app.this.default_domain}"
}

output "basic_auth_user" {
  value = var.basic_auth_user
}

output "basic_auth_password" {
  value     = random_password.basic_auth.result
  sensitive = true
}
