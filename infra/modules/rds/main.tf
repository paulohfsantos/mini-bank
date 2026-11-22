# RDS PostgreSQL do lab (aws.md §2.2): single-AZ, subnets isoladas, TLS obrigatório (SEC-20).

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg17"
  family = "postgres17"
  # Conexão sem TLS é recusada pelo servidor; o cliente valida o certificado (verify-full).
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Auditoria barata: conexões e sessões longas aparecem no log.
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class
  db_name        = var.database_name
  username       = "mbadmin"
  # Senha master gerada e guardada pelo RDS no Secrets Manager: não passa pelo state.
  manage_master_user_password = true

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = false
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period    = 1
  delete_automated_backups   = true
  skip_final_snapshot        = true  # lab efêmero
  deletion_protection        = false # idem
  auto_minor_version_upgrade = true
  apply_immediately          = true
  copy_tags_to_snapshot      = true

  performance_insights_enabled = false
}
