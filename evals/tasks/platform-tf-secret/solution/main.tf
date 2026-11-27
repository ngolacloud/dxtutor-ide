variable "db_password" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.db_password) >= 16
    error_message = "db_password must have at least 16 characters."
  }
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

output "db_endpoint" {
  value = aws_db_instance.orders.endpoint
}
