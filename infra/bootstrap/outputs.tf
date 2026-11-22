output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "github_deploy_role_arn" {
  description = "Vai no secret/variável do environment lab do GitHub (fase 7)."
  value       = aws_iam_role.github_deploy.arn
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}
