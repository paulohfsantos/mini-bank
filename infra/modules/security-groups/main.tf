# Firewall por função (aws.md §2.2). Regras como recursos separados (aws_vpc_security_group_*):
# cada regra tem descrição e aparece sozinha no plan.

# Faixas de origem do CloudFront (SEC-02). Conta como várias regras na cota do SG.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "ALB: HTTP so do CloudFront"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "API e task de migration: entrada so do ALB"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-api" }
}

resource "aws_security_group" "worker" {
  name        = "${var.name}-worker"
  description = "Worker: sem entrada"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-worker" }
}

resource "aws_security_group" "rds" {
  name        = "${var.name}-rds"
  description = "RDS: 5432 so da API e do worker"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-rds" }
}

# ---------- ALB ----------
resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP vindo apenas das faixas de origem do CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Encaminha para as tasks da API (target type ip)"
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
}

# ---------- API ----------
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "Trafego HTTP e health check do ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
}

# ---------- saída das tasks (api, migration, worker) ----------
# 443 para a internet: ECR, SQS, Secrets Manager, CloudWatch e X-Ray sem NAT (ADR-0013).
# DNS para o resolver da VPC não passa por security group.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  for_each          = { api = aws_security_group.api.id, worker = aws_security_group.worker.id }
  security_group_id = each.value
  description       = "HTTPS para as APIs da AWS (sem NAT)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "tasks_postgres" {
  for_each                     = { api = aws_security_group.api.id, worker = aws_security_group.worker.id }
  security_group_id            = each.value
  description                  = "Postgres no RDS"
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# ---------- RDS ----------
resource "aws_vpc_security_group_ingress_rule" "rds_from_tasks" {
  for_each                     = { api = aws_security_group.api.id, worker = aws_security_group.worker.id }
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres a partir do SG ${each.key}"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# Sem regra de saída no sg-rds: o RDS só responde (SG é stateful).
