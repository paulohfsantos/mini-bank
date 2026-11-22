mock_provider "aws" {
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:us-east-1:111122223333:fila" }
  }
}

variables {
  name = "mini-banco-test-transfer-events"
}

run "dlq_depois_de_5_tentativas" {
  command = apply # o redrive_policy depende do ARN da DLQ (só conhecido após criar)

  assert {
    condition     = jsondecode(aws_sqs_queue.main.redrive_policy).maxReceiveCount == 5
    error_message = "mensagem venenosa vai para a DLQ na 5ª entrega (ADR-0007)"
  }
  assert {
    condition     = aws_sqs_queue.main.sqs_managed_sse_enabled && aws_sqs_queue.dlq.sqs_managed_sse_enabled
    error_message = "filas criptografadas (SSE-SQS)"
  }
  assert {
    condition     = jsondecode(aws_sqs_queue_redrive_allow_policy.dlq.redrive_allow_policy).redrivePermission == "byQueue"
    error_message = "só a fila principal usa esta DLQ"
  }
}
