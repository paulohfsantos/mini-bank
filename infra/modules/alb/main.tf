# ALB atrás do CloudFront (ADR-0021, SEC-02). Duas travas:
#   rede: o SG só aceita o prefix list de origem do CloudFront;
#   aplicação: sem o header secreto X-Origin-Verify o listener responde 403 (bloqueia outra
#   distribuição CloudFront, de outra conta, usando este ALB como origem).

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.subnet_ids
  security_groups    = [var.security_group_id]
  # PERF-01: o Node usa keepAliveTimeout 65 s, acima deste idle timeout.
  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_deletion_protection = false # lab efêmero: destroy no fim da sessão
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  vpc_id      = var.vpc_id
  target_type = "ip" # Fargate awsvpc
  protocol    = "HTTP"
  port        = var.target_port
  # PERF-22: task saindo para de receber tráfego rápido; o graceful shutdown cobre o resto.
  deregistration_delay = 10

  health_check {
    path                = "/health/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP" # TLS termina no CloudFront (ADR-0021); débito sem domínio próprio
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10
  condition {
    http_header {
      http_header_name = var.origin_verify_header
      values           = [var.origin_verify_secret]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
