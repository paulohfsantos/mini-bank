#!/usr/bin/env bash
# Roda a task de migration (ADR-0026) no cluster do lab com a rede lida do SSM, espera terminar
# e falha se o exitCode não for 0. Mesmo fluxo que o deploy.yml usará na fase 7.
#   AWS_PROFILE=mini-banco ./scripts/run-migration.sh
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
P=/mini-banco/lab
param() { aws --region "$REGION" ssm get-parameter --name "$P/$1" --query Parameter.Value --output text; }

cluster="$(param cluster)"
subnets="$(param subnets)"
sg="$(param migrate-sg)"
family="$(param migrate-task-family)"
log_group="$(param migrate-log-group)"

task="$(aws --region "$REGION" ecs run-task --cluster "$cluster" --task-definition "$family" \
  --launch-type FARGATE --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
echo "task: $task"
aws --region "$REGION" ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"

code="$(aws --region "$REGION" ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
reason="$(aws --region "$REGION" ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].stoppedReason' --output text)"
echo "--- logs ($log_group)"
aws --region "$REGION" logs get-log-events --log-group-name "$log_group" \
  --log-stream-name "migrate/migrate/${task##*/}" --query 'events[].message' --output text | tr '\t' '\n' || true
if [ "$code" != "0" ]; then
  echo "migration falhou: exitCode=$code ($reason)" >&2
  exit 1
fi
echo "✔ migration ok"
