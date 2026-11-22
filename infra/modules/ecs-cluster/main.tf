# Cluster do lab: só Fargate.

resource "aws_ecs_cluster" "this" {
  name = var.name
  # Container Insights desligado (custo); ligar só em game day (aws.md §2.2).
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}
