# Task definition e service: o que o ECS recebe é o JSON de container_definitions.
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  # O json do policy document é computado; o mock precisa devolver JSON válido.
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  prefix               = "mini-banco-test"
  name                 = "api"
  cluster_arn          = "arn:aws:ecs:us-east-1:111122223333:cluster/mini-banco-test"
  image                = "111122223333.dkr.ecr.us-east-1.amazonaws.com/mini-banco/api:abc1234"
  ecr_repository_arn   = "arn:aws:ecr:us-east-1:111122223333:repository/mini-banco/api"
  container_port       = 3001
  target_group_arn     = "arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/api/1"
  subnet_ids           = ["subnet-a"]
  security_group_ids   = ["sg-api"]
  task_policy_json     = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  health_check_command = ["CMD-SHELL", "true"]
  adot                 = { image = "public.ecr.aws/aws-observability/aws-otel-collector:v0.51.0", config = "receivers: {}" }
}

run "container_sem_privilegios" {
  command = plan

  assert {
    condition = alltrue([
      for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.readonlyRootFilesystem
    ])
    error_message = "[SEC-35] todos os containers com filesystem somente leitura"
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].user == "1000:1000"
    error_message = "[SEC-35] a app roda como node (uid 1000), não root"
  }
}

run "ecs_exec_desligado_por_padrao" {
  command = plan

  assert {
    condition     = aws_ecs_service.this.enable_execute_command == false
    error_message = "[SEC-34] ECS Exec desligado por padrão"
  }
  assert {
    condition     = length(aws_iam_role_policy.exec) == 0
    error_message = "[SEC-34] sem permissões ssmmessages quando o Exec está desligado"
  }
}

run "ecs_exec_ligado_so_quando_pedido" {
  command = plan
  variables {
    enable_execute_command = true
  }

  assert {
    condition     = aws_ecs_service.this.enable_execute_command && length(aws_iam_role_policy.exec) == 1
    error_message = "[SEC-34] Exec ligado de propósito traz as permissões ssmmessages"
  }
}

run "memoria_por_container" {
  command = plan

  assert {
    condition = contains(
      [for e in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment : e.value if e.name == "NODE_OPTIONS"],
      "--max-old-space-size=460"
    )
    error_message = "[PERF-21] heap do Node em ~60% dos 768 MiB do container da app"
  }
  assert {
    condition = sum([
      for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.memory
    ]) <= aws_ecs_task_definition.this.memory
    error_message = "[PERF-21] a soma dos limites por container cabe na memória da task"
  }
}

run "sidecar_de_telemetria_nao_derruba_a_task" {
  command = plan

  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.essential if c.name == "adot"
    ] == [false]
    error_message = "[OBS-BR-02] ADOT não essencial: telemetria fora do ar não derruba o serviço"
  }
}

run "deploy_rolling_sem_perder_capacidade" {
  command = plan

  assert {
    condition = (
      aws_ecs_service.this.deployment_minimum_healthy_percent == 100 &&
      aws_ecs_service.this.deployment_maximum_percent == 200
    )
    error_message = "[PERF-22] sobe a task nova antes de tirar a antiga"
  }
  assert {
    condition = (
      aws_ecs_service.this.deployment_circuit_breaker[0].enable &&
      aws_ecs_service.this.deployment_circuit_breaker[0].rollback
    )
    error_message = "[PERF-22] circuit breaker com rollback"
  }
  assert {
    condition     = aws_ecs_service.this.health_check_grace_period_seconds == 60
    error_message = "[PERF-05] 60 s de carência antes do primeiro health check do ALB"
  }
}

run "worker_sem_load_balancer_nem_carencia" {
  command = plan
  variables {
    name             = "worker"
    container_port   = null
    target_group_arn = null
    adot             = null
  }

  assert {
    condition = (
      length(aws_ecs_service.this.load_balancer) == 0 &&
      aws_ecs_service.this.health_check_grace_period_seconds == null
    )
    error_message = "worker sem ALB: sem load_balancer e sem grace period"
  }
}
