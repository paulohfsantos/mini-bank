#!/usr/bin/env bash
# Fim de sessão (aws.md §5): procura qualquer coisa do lab que tenha sobrado depois do
# `terraform destroy` e que custe dinheiro. Só leitura. Saída 0 = limpo, 1 = sobrou algo.
#   AWS_PROFILE=mini-banco ./scripts/session-end-check.sh
set -uo pipefail
REGION="${AWS_REGION:-us-east-1}"
command -v aws >/dev/null || { echo "aws CLI não encontrado" >&2; exit 2; }
aws sts get-caller-identity >/dev/null 2>&1 || { echo "sem sessão AWS: aws sso login --profile mini-banco" >&2; exit 2; }

leftovers=0
check() { # check <descrição> <comando aws que imprime um item por linha>
  local what="$1" out
  shift
  out="$("$@" 2>&1 | grep -v '^None$' | sed '/^$/d')"
  if [ -n "$out" ]; then
    printf '✖ %s:\n%s\n' "$what" "$(printf '%s\n' "$out" | sed 's/^/    /')"
    leftovers=1
  else
    printf '✔ %s\n' "$what"
  fi
}

a() { aws --region "$REGION" --output text "$@"; }

# A API de tagging pode demorar alguns minutos para refletir exclusões.
check "recursos com tag Project=mini-banco, Env=lab" \
  a resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=mini-banco Key=Env,Values=lab \
  --query 'ResourceTagMappingList[].ResourceARN'
check "instâncias RDS" a rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier,'mini-banco')].DBInstanceIdentifier"
check "snapshots manuais do RDS" a rds describe-db-snapshots --snapshot-type manual --query "DBSnapshots[?starts_with(DBInstanceIdentifier,'mini-banco')].DBSnapshotIdentifier"
check "load balancers" a elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName,'mini-banco')].LoadBalancerName"
check "clusters ECS" a ecs list-clusters --query "clusterArns[?contains(@,'mini-banco')]"
check "Elastic IPs soltos" a ec2 describe-addresses --query 'Addresses[?AssociationId==null].PublicIp'
check "ENIs do projeto" a ec2 describe-network-interfaces --filters Name=tag:Project,Values=mini-banco --query 'NetworkInterfaces[].NetworkInterfaceId'
check "VPCs do lab" a ec2 describe-vpcs --filters Name=tag:Env,Values=lab Name=tag:Project,Values=mini-banco --query 'Vpcs[].VpcId'
check "apps Amplify" a amplify list-apps --query "apps[?starts_with(name,'mini-banco')].name"
check "distribuições CloudFront do lab" aws --output text cloudfront list-distributions --query "DistributionList.Items[?starts_with(Comment,'mini-banco-lab')].Id"
check "secrets do lab" a secretsmanager list-secrets --filters Key=name,Values=mini-banco/lab --query 'SecretList[].Name'

if [ "$leftovers" -eq 0 ]; then
  echo "Sessão encerrada: nada do lab ficou ligado. (No dia seguinte: Cost Explorer por tag Project.)"
else
  echo "Sobrou recurso do lab. Rode 'terraform destroy' de novo em infra/envs/lab ou apague à mão." >&2
fi
exit "$leftovers"
