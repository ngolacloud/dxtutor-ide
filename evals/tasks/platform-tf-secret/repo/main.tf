variable "db_password" {
  type    = string
  default = "hunter2-prod-2026"
}

variable "db_name" {
  type    = string
  default = "orders"
}

resource "aws_db_instance" "orders" {
  identifier        = "orders-db"
  engine            = "postgres"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  db_name           = var.db_name
  username          = "app"
  password          = var.db_password
}

output "db_password" {
  value = var.db_password
}

output "db_endpoint" {
  value = aws_db_instance.orders.endpoint
}
