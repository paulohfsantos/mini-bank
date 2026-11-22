# Composição do lab com provider simulado: sem conta AWS, sem backend.
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:us-east-1:111122223333:repository/mini-banco/x"
      repository_url = "111122223333.dkr.ecr.us-east-1.amazonaws.com/mini-banco/x"
    }
  }
}

mock_provider "random" {}

variables {
  image_tag             = "abc1234def56"
  desired_count         = 0
  alarm_email           = "alarms@example.com"
  github_repository_url = "https://github.com/owner/mini-bank"
}

run "sessao_comeca_com_services_parados" {
  command = plan

  assert {
    condition     = module.api.desired_count == 0 && module.worker.desired_count == 0
    error_message = "desired_count = 0 chega aos dois services: nada sobe antes da migration (ADR-0026)"
  }
}

run "desired_count_fora_da_faixa_e_recusado" {
  command = plan
  variables {
    desired_count = 5
  }
  expect_failures = [var.desired_count]
}

run "tag_de_imagem_precisa_ser_git_sha" {
  command = plan
  variables {
    image_tag = "latest"
  }
  expect_failures = [var.image_tag]
}

run "sem_token_o_lab_sobe_sem_front" {
  command = plan

  assert {
    condition     = output.amplify_url == null
    error_message = "github_token ausente: sem Amplify"
  }
}

run "adot_com_limite_de_memoria_e_metricas_de_baixa_cardinalidade" {
  command = plan

  assert {
    condition = alltrue([
      for svc in ["api", "worker"] :
      strcontains(local.adot_config[svc], "limit_mib: 204") && strcontains(local.adot_config[svc], "memory_limiter")
    ])
    error_message = "[PERF-21] memory_limiter do ADOT em 80% dos 256 MiB do sidecar"
  }
  assert {
    condition = alltrue([
      for svc in ["api", "worker"] :
      strcontains(local.adot_config[svc], "dimensions: [[reason], [rule], [outcome], []]")
    ])
    error_message = "[PERF-25] EMF só com as dimensões reason/rule/outcome"
  }
}
