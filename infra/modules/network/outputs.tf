output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = [for az in var.azs : aws_subnet.public[az].id]
}

output "isolated_subnet_ids" {
  value = [for az in var.azs : aws_subnet.isolated[az].id]
}
