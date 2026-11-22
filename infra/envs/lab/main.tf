# Ambiente lab (efêmero): apply no início da sessão, destroy no fim (aws.md §5).
# O que sobrevive ao destroy (state, ECR, OIDC, Budgets) fica em infra/bootstrap.

locals {
  name       = "mini-banco-lab"
  ssm_path   = "/mini-banco/lab"
  ca_file    = "/app/certs/rds-global-bundle.pem" # copiado na imagem (SEC-20)
  api_port   = 3001
  adot_mib   = 256
  health_cmd = "node -e \"fetch('http://127.0.0.1:%d/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""
}

data "aws_ecr_repository" "api" {
  name = "mini-banco/api"
}

data "aws_ecr_repository" "worker" {
  name = "mini-banco/worker"
}

module "network" {
  source = "../../modules/network"
  name   = local.name
  azs    = var.azs
}

module "sg" {
  source   = "../../modules/security-groups"
  name     = local.name
  vpc_id   = module.network.vpc_id
  api_port = local.api_port
}

module "secrets" {
  source = "../../modules/secrets"
  prefix = "mini-banco/lab"
}

module "sqs" {
  source = "../../modules/sqs"
  name   = "${local.name}-transfer-events"
}

module "rds" {
  source            = "../../modules/rds"
  name              = local.name
  subnet_ids        = module.network.isolated_subnet_ids
  security_group_id = module.sg.rds_sg_id
}

module "observability" {
  source                 = "../../modules/observability"
  prefix                 = local.name
  alarm_email            = var.alarm_email
  db_instance_identifier = module.rds.identifier
}

module "alb" {
  source               = "../../modules/alb"
  name                 = local.name
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.public_subnet_ids
  security_group_id    = module.sg.alb_sg_id
  origin_verify_secret = module.secrets.origin_verify_secret
  target_port          = local.api_port
}

module "edge" {
  source               = "../../modules/edge"
  name                 = local.name
  alb_dns_name         = module.alb.dns_name
  origin_verify_secret = module.secrets.origin_verify_secret
}

module "cluster" {
  source = "../../modules/ecs-cluster"
  name   = local.name
}

# ---------- permissões do código (task roles, aws.md §3.2 e §3.3) ----------
data "aws_iam_policy_document" "telemetry" {
  statement {
    sid = "XRayViaAdotNoResourceLevelSupport"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "EmfMetricsViaAdot"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [module.observability.metrics_log_group_arn, "${module.observability.metrics_log_group_arn}:*"]
  }
}

data "aws_iam_policy_document" "api_task" {
  source_policy_documents = [data.aws_iam_policy_document.telemetry.json]
  statement {
    sid       = "OutboxRelayPublish"
    actions   = ["sqs:SendMessage"] # sem acesso à DLQ
    resources = [module.sqs.queue_arn]
  }
}

data "aws_iam_policy_document" "worker_task" {
  source_policy_documents = [data.aws_iam_policy_document.telemetry.json]
  statement {
    sid = "ConsumeTransferEvents"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [module.sqs.queue_arn]
  }
}

locals {
  db_env = {
    DB_HOST        = module.rds.address
    DB_PORT        = tostring(module.rds.port)
    DB_NAME        = module.rds.database_name
    DB_SSL         = "verify-full"
    DB_SSL_CA_FILE = local.ca_file
  }
  common_env = {
    NODE_ENV                    = "production"
    LOG_LEVEL                   = "info"
    AWS_REGION                  = var.region
    SQS_QUEUE_URL               = module.sqs.queue_url
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
  }
  adot_config = { for svc, port in { api = 9464, worker = 9465 } : svc => templatefile("${path.module}/adot-config.yaml.tftpl", {
    service           = "mini-banco-${svc}"
    metrics_port      = port
    region            = var.region
    metrics_log_group = module.observability.metrics_log_group_name
    memory_limit_mib  = floor(local.adot_mib * 0.8)
    spike_limit_mib   = floor(local.adot_mib * 0.2)
  }) }
}

module "api" {
  source             = "../../modules/ecs-service"
  prefix             = local.name
  name               = "api"
  cluster_arn        = module.cluster.arn
  image              = "${data.aws_ecr_repository.api.repository_url}:${var.image_tag}"
  ecr_repository_arn = data.aws_ecr_repository.api.arn
  container_port     = local.api_port
  target_group_arn   = module.alb.target_group_arn
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [module.sg.api_sg_id]
  environment = merge(local.common_env, local.db_env, {
    PORT                 = tostring(local.api_port)
    DB_POOL_MAX          = "10" # PERF-02: 2 tasks no rolling × 10 + worker
    OUTBOX_RELAY_ENABLED = "true"
    OTEL_SERVICE_NAME    = "mini-banco-api"
    METRICS_PORT         = "9464"
  })
  secrets = {
    API_DB_USER     = "${module.secrets.db_secret_arns.api}:username::"
    API_DB_PASSWORD = "${module.secrets.db_secret_arns.api}:password::"
    API_KEYS        = module.secrets.api_key_secret_arn
  }
  secret_arns            = [module.secrets.db_secret_arns.api, module.secrets.api_key_secret_arn]
  task_policy_json       = data.aws_iam_policy_document.api_task.json
  health_check_command   = ["CMD-SHELL", format(local.health_cmd, local.api_port)]
  stop_timeout           = 30
  enable_execute_command = var.enable_execute_command
  adot                   = { image = var.adot_image, config = local.adot_config.api, memory = local.adot_mib }
  desired_count          = var.desired_count
}

module "worker" {
  source             = "../../modules/ecs-service"
  prefix             = local.name
  name               = "worker"
  cluster_arn        = module.cluster.arn
  image              = "${data.aws_ecr_repository.worker.repository_url}:${var.image_tag}"
  ecr_repository_arn = data.aws_ecr_repository.worker.arn
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [module.sg.worker_sg_id]
  environment = merge(local.common_env, local.db_env, {
    WORKER_DB_POOL_MAX = "5"
    WORKER_CONCURRENCY = "5"
    WORKER_HEALTH_PORT = "3002"
    OTEL_SERVICE_NAME  = "mini-banco-worker"
    METRICS_PORT       = "9465"
  })
  secrets = {
    WORKER_DB_USER     = "${module.secrets.db_secret_arns.worker}:username::"
    WORKER_DB_PASSWORD = "${module.secrets.db_secret_arns.worker}:password::"
  }
  secret_arns          = [module.secrets.db_secret_arns.worker]
  task_policy_json     = data.aws_iam_policy_document.worker_task.json
  health_check_command = ["CMD-SHELL", format(local.health_cmd, 3002)]
  # PERF-19: long polling de 20 s + lote em andamento antes do SIGKILL.
  stop_timeout           = 45
  enable_execute_command = var.enable_execute_command
  adot                   = { image = var.adot_image, config = local.adot_config.worker, memory = local.adot_mib }
  desired_count          = var.desired_count
}

# Migration (ADR-0026): imagem da api, senha master do RDS + senhas dos papéis de aplicação.
module "migrate" {
  source             = "../../modules/ecs-oneoff-task"
  prefix             = local.name
  name               = "migrate"
  image              = "${data.aws_ecr_repository.api.repository_url}:${var.image_tag}"
  ecr_repository_arn = data.aws_ecr_repository.api.arn
  command            = ["node", "dist/migrate.js"]
  environment        = merge(local.db_env, { LOG_LEVEL = "info" })
  secrets = {
    MASTER_DB_USER     = "${module.rds.master_secret_arn}:username::"
    MASTER_DB_PASSWORD = "${module.rds.master_secret_arn}:password::"
    API_DB_PASSWORD    = "${module.secrets.db_secret_arns.api}:password::"
    WORKER_DB_PASSWORD = "${module.secrets.db_secret_arns.worker}:password::"
  }
  secret_arns = [
    module.rds.master_secret_arn,
    module.secrets.db_secret_arns.api,
    module.secrets.db_secret_arns.worker,
  ]
}

module "web" {
  count          = var.github_token == null ? 0 : 1
  source         = "../../modules/amplify-web"
  name           = "mini-banco-web"
  repository_url = var.github_repository_url
  github_token   = var.github_token
  api_url        = "https://${module.edge.domain_name}"
  api_key        = module.secrets.web_api_key
}

module "ssm" {
  source = "../../modules/ssm-outputs"
  path   = local.ssm_path
  values = {
    "cluster"             = module.cluster.name
    "subnets"             = join(",", module.network.public_subnet_ids)
    "migrate-sg"          = module.sg.api_sg_id
    "migrate-task-family" = module.migrate.task_definition_family
    "migrate-log-group"   = module.migrate.log_group_name
    "api-service"         = module.api.service_name
    "api-task-family"     = module.api.task_definition_family
    "worker-service"      = module.worker.service_name
    "worker-task-family"  = module.worker.task_definition_family
    "api-url"             = "https://${module.edge.domain_name}"
    "alb-dns"             = module.alb.dns_name
    "queue-url"           = module.sqs.queue_url
    "amplify-app-id"      = try(module.web[0].app_id, "none")
  }
}
