output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (load balancers, NAT)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (EKS nodes, RDS)."
  value       = aws_subnet.private[*].id
}

output "nat_gateway_id" {
  description = "ID of the single shared NAT gateway."
  value       = aws_nat_gateway.this.id
}
