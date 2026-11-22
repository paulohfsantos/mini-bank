output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

output "metrics_log_group_name" {
  value = aws_cloudwatch_log_group.metrics.name
}

output "metrics_log_group_arn" {
  value = aws_cloudwatch_log_group.metrics.arn
}
