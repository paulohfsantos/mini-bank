mock_provider "aws" {
  mock_data "aws_ec2_managed_prefix_list" {
    defaults = { id = "pl-cloudfront" }
  }
}

variables {
  name   = "mini-banco-test"
  vpc_id = "vpc-123"
}

run "alb_so_aceita_o_cloudfront" {
  command = plan

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.prefix_list_id == "pl-cloudfront" &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.cidr_ipv6 == null &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.from_port == 80 &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.to_port == 80
    )
    error_message = "[SEC-02] sg-alb: só a porta 80 e só do prefix list de origem do CloudFront"
  }
}

run "api_so_recebe_do_alb_e_rds_so_das_tasks" {
  command = plan

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.api_from_alb.cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.api_from_alb.from_port == 3001
    )
    error_message = "sg-api: 3001 só a partir do sg-alb, nunca de CIDR"
  }
  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_ingress_rule.rds_from_tasks :
      r.cidr_ipv4 == null && r.from_port == 5432 && r.to_port == 5432
    ]) && length(aws_vpc_security_group_ingress_rule.rds_from_tasks) == 2
    error_message = "sg-rds: 5432 só dos SGs da api e do worker"
  }
}

run "saida_das_tasks_restrita" {
  command = plan

  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_egress_rule.tasks_https :
      r.from_port == 443 && r.to_port == 443 && r.ip_protocol == "tcp"
    ])
    error_message = "egress das tasks para a internet só em 443 (ADR-0013)"
  }
}
