# Sem AWS: provider simulado, só o plan. Valida as travas do ALB atrás do CloudFront.
mock_provider "aws" {}

variables {
  name                 = "mini-banco-test"
  vpc_id               = "vpc-123"
  subnet_ids           = ["subnet-a", "subnet-b"]
  security_group_id    = "sg-alb"
  origin_verify_secret = "segredo-de-teste"
}

run "sem_header_de_origem_responde_403" {
  command = plan

  assert {
    condition     = aws_lb_listener.http.default_action[0].type == "fixed-response"
    error_message = "[SEC-02] a ação padrão do listener precisa ser fixed-response"
  }
  assert {
    condition     = aws_lb_listener.http.default_action[0].fixed_response[0].status_code == "403"
    error_message = "[SEC-02] sem o header de origem o ALB responde 403"
  }
}

run "so_encaminha_com_o_header_secreto" {
  command = plan

  assert {
    # jsonencode compara a estrutura sem depender de set/list/tuple.
    condition = nonsensitive(jsonencode([
      for c in aws_lb_listener_rule.from_cloudfront.condition : [
        for h in c.http_header : [h.http_header_name, sort(h.values)]
      ]
    ])) == jsonencode([[["X-Origin-Verify", ["segredo-de-teste"]]]])
    error_message = "[SEC-02] a única condição de forward é X-Origin-Verify com o segredo"
  }
  assert {
    condition     = aws_lb_listener_rule.from_cloudfront.action[0].type == "forward"
    error_message = "[SEC-02] a regra com header encaminha ao target group"
  }
  assert {
    condition     = aws_lb.this.drop_invalid_header_fields
    error_message = "headers inválidos são descartados"
  }
}

run "timeouts_e_drenagem" {
  command = plan

  assert {
    condition     = aws_lb.this.idle_timeout == 60
    error_message = "[PERF-01] idle timeout do ALB (60 s) abaixo do keepAliveTimeout do Node (65 s)"
  }
  assert {
    condition     = aws_lb_target_group.api.deregistration_delay == "10"
    error_message = "[PERF-22] deregistration delay de 10 s"
  }
  assert {
    condition     = aws_lb_target_group.api.health_check[0].path == "/health/ready"
    error_message = "health check do ALB no readiness (OBS-BR-10)"
  }
}
