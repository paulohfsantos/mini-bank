# Rede do lab (ADR-0013): sem NAT. Subnets públicas para ALB e tasks (IP público, saída pelo
# IGW) e subnets isoladas, sem rota para a internet, para o RDS.

locals {
  public   = { for i, az in var.azs : az => cidrsubnet(var.cidr_block, 8, i) }      # 10.20.0.0/24, 10.20.1.0/24
  isolated = { for i, az in var.azs : az => cidrsubnet(var.cidr_block, 8, 10 + i) } # 10.20.10.0/24, 10.20.11.0/24
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

# O SG default da VPC fica sem regras: nada usa "default" por acidente.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-default-closed" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-igw" }
}

resource "aws_subnet" "public" {
  for_each          = local.public
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value
  # IP público vem do assignPublicIp do service, não da subnet: nada ganha IP sem pedir.
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public-${substr(each.key, -1, 1)}", Tier = "public" }
}

resource "aws_subnet" "isolated" {
  for_each          = local.isolated
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value
  tags              = { Name = "${var.name}-isolated-${substr(each.key, -1, 1)}", Tier = "isolated" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# Só a rota local da VPC: o RDS não alcança a internet nem é alcançável por ela.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-isolated" }
}

resource "aws_route_table_association" "isolated" {
  for_each       = aws_subnet.isolated
  subnet_id      = each.value.id
  route_table_id = aws_route_table.isolated.id
}

data "aws_region" "current" {}

# Layers das imagens do ECR vêm do S3: pelo gateway endpoint, sem custo e sem sair da AWS.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "${var.name}-s3" }
}
