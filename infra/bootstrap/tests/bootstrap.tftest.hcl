mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  github_owner = "owner"
  github_repo  = "mini-bank"
  budget_email = "budget@example.com"
}

run "state_privado_versionado_e_criptografado" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.state.block_public_acls,
      aws_s3_bucket_public_access_block.state.block_public_policy,
      aws_s3_bucket_public_access_block.state.ignore_public_acls,
      aws_s3_bucket_public_access_block.state.restrict_public_buckets,
    ])
    error_message = "[SEC-33] bucket de state com Block Public Access completo"
  }
  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "[SEC-33] state versionado (recuperável)"
  }
  assert {
    condition = jsonencode([
      for r in aws_s3_bucket_server_side_encryption_configuration.state.rule : [
        for d in r.apply_server_side_encryption_by_default : d.sse_algorithm
      ]
    ]) == jsonencode([["AES256"]])
    error_message = "[SEC-33] state criptografado em repouso"
  }
  assert {
    condition = jsonencode([
      for s in data.aws_iam_policy_document.state_bucket.statement : [s.effect, [for c in s.condition : [c.variable, c.values]]]
    ]) == jsonencode([["Deny", [["aws:SecureTransport", ["false"]]]]])
    error_message = "[SEC-33] acesso ao state só com TLS"
  }
}

run "oidc_so_do_environment_lab_deste_repo" {
  command = plan

  assert {
    condition = contains(flatten([
      for s in data.aws_iam_policy_document.github_trust.statement : [
        for c in s.condition : c.values if c.variable == "token.actions.githubusercontent.com:sub"
      ]
    ]), "repo:owner/mini-bank:environment:lab")
    error_message = "trust da role de deploy restrito a repo:<owner>/<repo>:environment:lab (PR de outra branch não assume)"
  }
}

run "passrole_so_das_roles_do_lab_e_so_para_ecs" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in data.aws_iam_policy_document.github_deploy.statement : [
        for r in s.resources : startswith(r, "arn:aws:iam::111122223333:role/mini-banco-lab-")
      ] if contains(s.actions, "iam:PassRole")
    ]))
    error_message = "iam:PassRole só para as roles nomeadas do lab (sem escalar privilégio pelo CI)"
  }
  assert {
    condition = contains(flatten([
      for s in data.aws_iam_policy_document.github_deploy.statement : [
        for c in s.condition : c.values if c.variable == "iam:PassedToService"
      ] if contains(s.actions, "iam:PassRole")
    ]), "ecs-tasks.amazonaws.com")
    error_message = "iam:PassRole só para ecs-tasks.amazonaws.com"
  }
  assert {
    condition = !anytrue(flatten([
      for s in data.aws_iam_policy_document.github_deploy.statement : [
        for a in s.actions : endswith(a, ":*") || a == "*"
      ]
    ]))
    error_message = "nenhuma ação curinga (iam:*, ecs:*, ...) na role do CI"
  }
}

run "imagens_imutaveis" {
  command = plan

  assert {
    condition     = alltrue([for r in aws_ecr_repository.app : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "tag = git sha, nunca reescrita"
  }
}
