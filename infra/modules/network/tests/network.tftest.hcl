mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
}

variables {
  name = "mini-banco-test"
  azs  = ["us-east-1a", "us-east-1b"]
}

run "subnets_isoladas_sem_rota_para_a_internet" {
  command = apply # o conjunto de rotas da route table só é conhecido depois de criar (mock)

  assert {
    condition     = aws_route.public_internet.route_table_id == aws_route_table.public.id
    error_message = "a única rota 0.0.0.0/0 é a da route table pública"
  }
  assert {
    condition     = length(aws_route_table.isolated.route) == 0
    error_message = "route table isolada sem rotas além da local (RDS sem internet)"
  }
  assert {
    condition = alltrue([for s in aws_subnet.isolated : s.map_public_ip_on_launch != true]) && alltrue([
      for s in aws_subnet.public : s.map_public_ip_on_launch == false
    ])
    error_message = "nenhuma subnet distribui IP público automaticamente"
  }
}

run "duas_azs_obrigatorias" {
  command = plan
  variables {
    azs = ["us-east-1a"]
  }
  expect_failures = [var.azs]
}
