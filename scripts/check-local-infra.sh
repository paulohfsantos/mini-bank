#!/usr/bin/env bash
# Verifica se a infraestrutura local está pronta e configurada como esperado.
# Usa só curl e docker (sem AWS CLI). Uso: pnpm infra:check
set -euo pipefail

SQS=${SQS_ENDPOINT:-http://localhost:9324}
QUEUE=mini-banco-transfer-events
DLQ=${QUEUE}-dlq
fail=0

ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

# Espera um endpoint responder (até ~30 s).
wait_for() {
  local url=$1
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "$url" && return 0
    sleep 1
  done
  return 1
}

echo "Postgres"
if docker compose exec -T postgres pg_isready -U minibanco -d minibanco >/dev/null 2>&1; then
  ok "aceitando conexões"
else
  bad "pg_isready falhou"
fi

echo "SQS (ElasticMQ)"
if wait_for "$SQS/?Action=ListQueues"; then
  queues=$(curl -sf "$SQS/?Action=ListQueues")
  for q in "$QUEUE" "$DLQ"; do
    if grep -q "/$q<" <<<"$queues"; then ok "fila $q existe"; else bad "fila $q não encontrada"; fi
  done
  attrs=$(curl -sf "$SQS/000000000000/$QUEUE?Action=GetQueueAttributes&AttributeName.1=All")
  if grep -q 'maxReceiveCount' <<<"$attrs" && grep -q "$DLQ" <<<"$attrs"; then
    ok "redrive policy aponta para $DLQ"
  else
    bad "redrive policy ausente em $QUEUE"
  fi
  grep -q '<Value>30</Value>' <<<"$attrs" && ok "visibility timeout 30 s" || bad "visibility timeout diferente de 30 s"
else
  bad "API SQS não respondeu em $SQS"
fi

echo "Jaeger"
if wait_for "http://localhost:16686"; then ok "UI em http://localhost:16686"; else bad "UI não respondeu"; fi

exit $fail
