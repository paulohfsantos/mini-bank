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

# A API de tagging é eventualmente consistente e lista também o que já foi apagado ou ficou
# inativo: recurso EC2 removido (some em minutos), cluster/service/task definition ECS INACTIVE e
# task STOPPED (registros que a AWS guarda por um tempo, sem custo). Cada ARN listado é conferido
# na API do próprio serviço; só conta como sobra o que ainda existe e está ativo. Tipo sem
# conferência conhecida conta como sobra (na dúvida, alerta).
# Só "NotFound" prova que o recurso EC2 sumiu; qualquer outro erro (AccessDenied, throttling) conta
# como existente, para alertar em vez de esconder uma sobra.
EC2_OUT=""
ec2_exists() {
  local err
  err="$(mktemp)"
  if EC2_OUT="$("$@" 2>"$err")"; then rm -f "$err"; return 0; fi
  if grep -q 'NotFound' "$err"; then rm -f "$err"; return 1; fi
  rm -f "$err"
  return 0
}

alive() { # alive <arn>: 0 = ainda existe e está ativo
  local arn="$1" res="${1#arn:aws:*:*:*:}" id status
  id="${res##*/}"
  case "$arn" in
    arn:aws:ec2:*:security-group/*)
      ec2_exists a ec2 describe-security-groups --group-ids "$id" --query 'SecurityGroups[].GroupId' ;;
    arn:aws:ec2:*:security-group-rule/*)
      ec2_exists a ec2 describe-security-group-rules --security-group-rule-ids "$id" --query 'SecurityGroupRules[].SecurityGroupRuleId' ;;
    arn:aws:ec2:*:vpc-endpoint/*)
      ec2_exists a ec2 describe-vpc-endpoints --vpc-endpoint-ids "$id" --query 'VpcEndpoints[0].State' || return 1
      case "$EC2_OUT" in deleted | deleting) return 1 ;; esac ;;
    arn:aws:ecs:*:cluster/*)
      [ "$(a ecs describe-clusters --clusters "$arn" --query 'clusters[0].status' 2>/dev/null)" = ACTIVE ] ;;
    arn:aws:ecs:*:service/*)
      [ "$(a ecs describe-services --cluster "$(printf '%s' "$res" | cut -d/ -f2)" --services "$arn" --query 'services[0].status' 2>/dev/null)" = ACTIVE ] ;;
    arn:aws:ecs:*:task-definition/*)
      [ "$(a ecs describe-task-definition --task-definition "$arn" --query 'taskDefinition.status' 2>/dev/null)" = ACTIVE ] ;;
    arn:aws:ecs:*:task/*)
      status="$(a ecs describe-tasks --cluster "$(printf '%s' "$res" | cut -d/ -f2)" --tasks "$arn" --query 'tasks[0].lastStatus' 2>/dev/null)" || return 1
      case "$status" in STOPPED | DELETED | None | "") return 1 ;; esac ;;
    *) return 0 ;;
  esac
}

tagged_alive() {
  local arn
  a resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=mini-banco Key=Env,Values=lab \
    --query 'ResourceTagMappingList[].ResourceARN' | tr '\t' '\n' | grep -v '^None$' | sed '/^$/d' |
    while IFS= read -r arn; do
      if alive "$arn"; then echo "$arn"; fi
    done
}
check "recursos com tag Project=mini-banco, Env=lab (ainda ativos)" tagged_alive
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
