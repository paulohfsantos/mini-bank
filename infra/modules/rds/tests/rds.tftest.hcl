mock_provider "aws" {}

variables {
  name              = "mini-banco-test"
  subnet_ids        = ["subnet-iso-a", "subnet-iso-b"]
  security_group_id = "sg-rds"
}

run "tls_obrigatorio_e_sem_acesso_publico" {
  command = plan

  assert {
    condition = [
      for p in aws_db_parameter_group.this.parameter : p.value if p.name == "rds.force_ssl"
    ] == ["1"]
    error_message = "[SEC-20] o servidor recusa conexão sem TLS (rds.force_ssl = 1)"
  }
  assert {
    condition     = aws_db_instance.this.publicly_accessible == false
    error_message = "RDS sem endpoint público"
  }
  assert {
    condition     = aws_db_instance.this.db_subnet_group_name == aws_db_subnet_group.this.name && aws_db_subnet_group.this.subnet_ids == toset(["subnet-iso-a", "subnet-iso-b"])
    error_message = "RDS só nas subnets isoladas recebidas"
  }
}

run "segredo_master_fora_do_state" {
  command = plan

  assert {
    condition     = aws_db_instance.this.manage_master_user_password && aws_db_instance.this.password == null
    error_message = "[SEC-33] senha master gerenciada pelo RDS, nunca no state"
  }
  assert {
    condition     = aws_db_instance.this.storage_encrypted
    error_message = "storage criptografado"
  }
}
