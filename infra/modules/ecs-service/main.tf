# Service Fargate reutilizado por api e worker (aws.md §2.2, §3): task definition (app + sidecar
# ADOT opcional), service, log group e duas roles por service (execution ≠ task).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  family     = "${var.prefix}-${var.name}"
  heap_mib   = floor(var.app_memory * 0.6)
  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.this.name
      awslogs-region        = local.region
      awslogs-stream-prefix = var.name
    }
  }
  tmp_mount = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]

  app_container = {
    name      = var.name
    image     = var.image
    essential = true
    memory    = var.app_memory
    user      = "1000:1000" # node, igual ao USER da imagem (SEC-35)
    # Código e dependências somente leitura; escrita só no volume efêmero em /tmp.
    readonlyRootFilesystem = true
    mountPoints            = local.tmp_mount
    portMappings = var.container_port == null ? [] : [
      { containerPort = var.container_port, protocol = "tcp" }
    ]
    environment = [
      for k, v in merge(var.environment, {
        NODE_OPTIONS = "--max-old-space-size=${local.heap_mib}"
      }) : { name = k, value = v }
    ]
    secrets          = [for k, v in var.secrets : { name = k, valueFrom = v }]
    logConfiguration = local.log_config
    healthCheck = {
      command     = var.health_check_command
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    stopTimeout = var.stop_timeout
    # Sidecar sobe antes, para não perder os primeiros spans; não é dependência dura.
    dependsOn = var.adot == null ? [] : [{ containerName = "adot", condition = "START" }]
  }

  adot_container = var.adot == null ? [] : [{
    name = "adot"
    # Não essencial: telemetria fora do ar não derruba o serviço (OBS-BR-02).
    essential              = false
    image                  = var.adot.image
    memory                 = var.adot.memory
    readonlyRootFilesystem = true
    mountPoints            = local.tmp_mount
    environment            = [{ name = "AOT_CONFIG_CONTENT", value = var.adot.config }]
    logConfiguration       = merge(local.log_config, { options = merge(local.log_config.options, { awslogs-stream-prefix = "adot" }) })
  }]
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.prefix}/${var.name}"
  retention_in_days = var.log_retention_days
}

# ---------- IAM ----------
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    # Confused deputy: só tasks desta conta e região.
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${local.region}:${local.account_id}:*"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.family}-execution"
  description        = "Agente do ECS: pull da imagem, logs e injeção de secrets do ${var.name}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "EcrAuthTokenNoResourceLevelSupport"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "PullOwnImage"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
    resources = [var.ecr_repository_arn]
  }
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
  dynamic "statement" {
    for_each = length(var.secret_arns) > 0 ? [1] : []
    content {
      sid       = "InjectOwnSecrets"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = var.secret_arns
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_iam_role" "task" {
  name               = "${local.family}-task"
  description        = "Código do ${var.name} e sidecar ADOT"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy" "task" {
  name   = "app"
  role   = aws_iam_role.task.id
  policy = var.task_policy_json
}

# Só quando o ECS Exec é ligado de propósito (SEC-34).
data "aws_iam_policy_document" "exec" {
  statement {
    sid = "EcsExecNoResourceLevelSupport"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "exec" {
  count  = var.enable_execute_command ? 1 : 0
  name   = "ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.exec.json
}

# ---------- task definition e service ----------
resource "aws_ecs_task_definition" "this" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # Graviton (ADR-0018)
  }
  # Sem host_path: armazenamento efêmero da própria task.
  volume {
    name = "tmp"
  }
  container_definitions = jsonencode(concat([local.app_container], local.adot_container))
}

resource "aws_ecs_service" "this" {
  name                    = var.name
  cluster                 = var.cluster_arn
  task_definition         = aws_ecs_task_definition.this.arn
  desired_count           = var.desired_count
  launch_type             = "FARGATE"
  enable_execute_command  = var.enable_execute_command
  propagate_tags          = "SERVICE"
  enable_ecs_managed_tags = true

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = true # sem NAT (ADR-0013); o SG não tem ingress da internet
  }

  # PERF-22: com 1 task, sobe a nova antes de tirar a antiga.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [1]
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }
  # PERF-05: boot com OTel em 0,25 vCPU antes do primeiro health check do ALB.
  health_check_grace_period_seconds = var.target_group_arn == null ? null : 60

  # Deploys do CI registram novas revisões (fase 7); o Terraform não as reverte.
  lifecycle {
    ignore_changes = [task_definition]
  }
}
