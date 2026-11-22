# Observabilidade mínima da fase 6: tópico de alarmes, log group das métricas EMF do ADOT e o
# alarme de créditos de CPU do RDS (PERF-13). Dashboard e demais alarmes: fase 8.

# Sem KMS: alarmes do CloudWatch não publicam em tópico cifrado com a chave gerenciada aws/sns
# (exigiria CMK com key policy para cloudwatch.amazonaws.com). Conteúdo: só nomes de alarmes.
resource "aws_sns_topic" "alarms" {
  name = "${var.prefix}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Destino do exporter awsemf do ADOT (métricas de negócio sem PutMetricData).
resource "aws_cloudwatch_log_group" "metrics" {
  name              = "/${var.prefix}/metrics"
  retention_in_days = var.log_retention_days
}

# PERF-13: t4g em modo Unlimited não estrangula; cobra. Saldo baixo avisa antes da conta.
resource "aws_cloudwatch_metric_alarm" "rds_cpu_credit_balance" {
  alarm_name          = "${var.prefix}-rds-cpu-credit-balance-low"
  alarm_description   = "PERF-13: créditos de CPU do RDS acabando (próximo passo: cobrança de surplus)"
  namespace           = "AWS/RDS"
  metric_name         = "CPUCreditBalance"
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 20
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_surplus_charged" {
  alarm_name          = "${var.prefix}-rds-cpu-surplus-charged"
  alarm_description   = "PERF-13: créditos de surplus cobrados (custo além da instância)"
  namespace           = "AWS/RDS"
  metric_name         = "CPUSurplusCreditsCharged"
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
