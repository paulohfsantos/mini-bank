output "api_cloudfront_domain" {
  description = "Entrada pública da API (HTTPS)."
  value       = module.edge.domain_name
}

output "alb_dns" {
  description = "Acesso direto deve falhar: SG só aceita o CloudFront (SEC-02)."
  value       = module.alb.dns_name
}

output "amplify_url" {
  value = try(module.web[0].url, null)
}

output "amplify_basic_auth_user" {
  value = try(module.web[0].basic_auth_user, null)
}

output "amplify_basic_auth_password" {
  description = "terraform output -raw amplify_basic_auth_password"
  value       = try(module.web[0].basic_auth_password, null)
  sensitive   = true
}

output "cluster_name" {
  value = module.cluster.name
}

output "dlq_name" {
  value = module.sqs.dlq_name
}
