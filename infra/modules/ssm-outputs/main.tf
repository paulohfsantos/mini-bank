# Saídas do Terraform para o CI (fase 7) no Parameter Store: o pipeline lê rede, cluster e
# nomes sem acesso ao state. Parâmetros String standard (sem custo); nada secreto aqui.

resource "aws_ssm_parameter" "this" {
  for_each = var.values
  name     = "${var.path}/${each.key}"
  type     = "String"
  value    = each.value
}
