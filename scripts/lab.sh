#!/usr/bin/env bash
# lab.sh: sessão do ambiente AWS (fase 6) de ponta a ponta, com sucesso e falha explícitos.
#
#   ./scripts/lab.sh up [--push] [--yes]   sobe: apply (services em 0) → migration → services em 1
#                                          → espera estabilizar → smoke (CloudFront 200, ALB direto falha)
#   ./scripts/lab.sh down [--yes]          destroy → session-end-check (nada do lab pode sobrar)
#   ./scripts/lab.sh status                saídas do Terraform, tasks rodando e health pelo CloudFront
#   ./scripts/lab.sh bootstrap [--yes]     uma vez por conta: state, OIDC, ECR, budget (infra/bootstrap);
#                                          na 1ª vez aplica com state local e o migra para o bucket criado
#
#   --push   faz build e push das imagens do HEAD se ainda não estiverem no ECR
#   --yes    não pergunta antes do apply/destroy (o plan ainda é impresso)
#
# Pré-requisitos: aws CLI com sessão SSO (aws sso login --profile mini-banco; AWS_PROFILE exportado),
# nunca como root (o script recusa). up: bootstrap aplicado, TF_VAR_alarm_email (e TF_VAR_github_token,
# se quiser o front). bootstrap: TF_VAR_budget_email.
# Terraform: o binário local se for a versão de infra/.terraform-version; senão o container
# com essa versão, recebendo só credenciais temporárias da sessão SSO (nada de ~/.aws montado).
# Logs: .logs/lab-<etapa>.log. Saída: 0 ok | 1 etapa falhou | 2 pré-requisito ausente | 130 Ctrl+C.
# Compatível com o bash 3.2 do macOS.

set -uo pipefail
# bash 3.2 (macOS) + set -u: "${a[@]}" com array vazio aborta ("unbound variable"). Arrays que
# podem ficar vazios são expandidos como ${a[@]+"${a[@]}"}.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB_DIR="$ROOT/infra/envs/lab"
BOOTSTRAP_DIR="$ROOT/infra/bootstrap"
TF_REL="envs/lab" # diretório do root Terraform (relativo a infra/) usado por tf()
LOG_DIR="$ROOT/.logs"
REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION="$REGION"
TF_VERSION="$(tr -d '[:space:]' <"$ROOT/infra/.terraform-version")"
CF_WAIT_SECONDS="${LAB_CF_WAIT_SECONDS:-900}" # CloudFront leva minutos para propagar

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

CMD="${1:-}"
[ $# -gt 0 ] && shift
PUSH=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --yes) YES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "opção desconhecida: $arg" >&2; usage >&2; exit 2 ;;
  esac
done
case "$CMD" in
  up | down | status | bootstrap) ;;
  -h | --help | help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# ---------- saída ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RESET=$'\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' RESET=''
fi
info() { printf '%s\n' "${DIM}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}⚠ $*${RESET}"; }
fail() { printf '%s\n' "${RED}✖ $*${RESET}" >&2; }
title() { printf '\n%s\n' "${BOLD}== $* ==${RESET}"; }

STEP_NAMES=()
STEP_STATUS=()
STEP_SECONDS=()
STARTED_AT=$(date +%s)
record() { STEP_NAMES+=("$1"); STEP_STATUS+=("$2"); STEP_SECONDS+=("$3"); }

summary() {
  title "Resumo ($CMD)"
  if [ "${#STEP_NAMES[@]}" -eq 0 ]; then info "  nenhuma etapa executada"; return; fi
  local i
  for i in "${!STEP_NAMES[@]}"; do
    case "${STEP_STATUS[$i]}" in
      ok) printf '  %s✔%s %4ss  %s\n' "$GREEN" "$RESET" "${STEP_SECONDS[$i]}" "${STEP_NAMES[$i]}" ;;
      *) printf '  %s✖ %4ss  %s%s\n' "$RED" "${STEP_SECONDS[$i]}" "${STEP_NAMES[$i]}" "$RESET" ;;
    esac
  done
  printf '  %s(total: %ss, logs em .logs/lab-*.log)%s\n' "$DIM" "$(($(date +%s) - STARTED_AT))" "$RESET"
}

on_interrupt() {
  printf '\n'
  warn "interrompido (Ctrl+C). Se foi no meio de um apply/destroy, o lock do state é liberado pelo Terraform;"
  warn "confira com './scripts/lab.sh status' e, no fim do dia, './scripts/lab.sh down'."
  summary
  exit 130
}
trap on_interrupt INT TERM

hint_for() {
  case "$1" in
    apply*) echo "Respondeu 'no'? Nada foi aplicado; rode de novo. Senão, leia o erro do Terraform no log. Recurso já existe? 'terraform state list'. Quota/conta não verificada (CloudFront)? Suporte da AWS." ;;
    migrate) echo "Logs da task acima. 'ResourceInitializationError' = secrets/rede; 'dbmate' = SQL da migration; 'password authentication' = rode de novo." ;;
    stable) echo "aws ecs describe-services --cluster mini-banco-lab --services api worker --query 'services[].events[:5]'" ;;
    smoke-cf) echo "CloudFront ainda propagando? Rode './scripts/lab.sh status' em alguns minutos. 502/503: target group do ALB (health check)." ;;
    smoke-alb) echo "O ALB respondeu direto: confira o sg-alb (prefix list do CloudFront) e a regra do header de origem (SEC-02)." ;;
    init-local | apply-bootstrap) echo "Respondeu 'no'? Nada foi aplicado. Senão: erro do Terraform no log. 'BucketAlreadyExists': o nome tem o account id; outra conta? 'AccessDenied': a sessão é LabAdmin?" ;;
    migrate-state | verify-state) echo "Rode './scripts/lab.sh bootstrap' de novo: ele retoma pela migração (o state local continua em infra/bootstrap)." ;;
    destroy) echo "'still has dependencies': espere as ENIs das tasks sumirem (~minutos) e rode 'down' de novo." ;;
    leftovers) echo "A API de tagging demora a refletir exclusões; rode 'scripts/session-end-check.sh' de novo em alguns minutos." ;;
    *) echo "Veja o log completo." ;;
  esac
}

# run_step <id> <nome> <comando...>: saída na tela E no log; mede e registra.
run_step() {
  local id="$1" name="$2"
  shift 2
  local log="$LOG_DIR/lab-$id.log" start status
  printf '%s▶%s %s\n' "$BOLD" "$RESET" "$name"
  start=$(date +%s)
  "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    printf '  %s✔ ok%s %s(%ss)%s\n' "$GREEN" "$RESET" "$DIM" "$(($(date +%s) - start))" "$RESET"
    record "$name" ok "$(($(date +%s) - start))"
    return 0
  fi
  printf '  %s✖ falhou (código %s)%s  log: %s\n' "$RED" "$status" "$RESET" "${log#"$ROOT"/}"
  printf '  %sdica:%s %s\n' "$YELLOW" "$RESET" "$(hint_for "$id")"
  record "$name" falhou "$(($(date +%s) - start))"
  return 1
}

must() {
  run_step "$@" && return 0
  summary
  printf '\n%s\n' "${RED}${BOLD}FALHOU${RESET}${RED}: corrija a etapa acima e rode de novo (as etapas são idempotentes).${RESET}"
  [ "$CMD" = "up" ] && printf '%s\n' "${YELLOW}O ambiente pode estar de pé e custando: './scripts/lab.sh down' se for parar por hoje.${RESET}"
  exit 1
}

# ---------- Terraform ----------
TF_MODE=""
tf() {
  if [ "$TF_MODE" = "local" ]; then
    (cd "$ROOT/infra/$TF_REL" && terraform "$@")
    return
  fi
  # -i quando o terminal é interativo: o "yes" do apply/destroy chega ao container pelo stdin.
  # Só stdin importa: o stdout sempre passa pelo tee do log (não é tty).
  local stdin_flags=()
  [ -t 0 ] && stdin_flags=(-i)
  # Credenciais temporárias da sessão atual, só como env do container.
  local creds
  creds="$(aws configure export-credentials --format env-no-export 2>/dev/null)" || {
    fail "não consegui exportar as credenciais da sessão (aws sso login?)"
    return 1
  }
  local envs=() line
  while IFS= read -r line; do [ -n "$line" ] && envs+=(-e "$line"); done <<<"$creds"
  local v
  for v in TF_VAR_alarm_email TF_VAR_github_token TF_VAR_budget_email; do
    [ -n "${!v:-}" ] && envs+=(-e "$v=${!v}")
  done
  docker run --rm ${stdin_flags[@]+"${stdin_flags[@]}"} ${envs[@]+"${envs[@]}"} -e AWS_REGION="$REGION" -e TF_IN_AUTOMATION=1 \
    -v "$ROOT/infra:/infra" -w "/infra/$TF_REL" "hashicorp/terraform:$TF_VERSION" "$@"
}

image_tag() { git -C "$ROOT" rev-parse --short=12 HEAD; }

image_exists() { # image_exists <repo> <tag>
  aws ecr describe-images --repository-name "mini-banco/$1" --image-ids "imageTag=$2" >/dev/null 2>&1
}

param() { aws ssm get-parameter --name "/mini-banco/lab/$1" --query Parameter.Value --output text; }

# ---------- pré-requisitos ----------
title "Pré-requisitos"
[ -d "$HOME/.docker/bin" ] && PATH="$HOME/.docker/bin:$PATH"
command -v aws >/dev/null 2>&1 || { fail "aws CLI não encontrado (brew install awscli)"; exit 2; }
if ! CALLER="$(aws sts get-caller-identity --query '[Account,Arn]' --output text 2>/dev/null)"; then
  fail "sem sessão AWS. Rode: aws sso login --profile mini-banco && export AWS_PROFILE=mini-banco"
  exit 2
fi
ACCOUNT="${CALLER%%[[:space:]]*}"
CALLER_ARN="${CALLER##*[[:space:]]}"
# Root não tem limite de permissão nem MFA nas chamadas de CLI: nada deste projeto roda como root.
case "$CALLER_ARN" in
  *:root)
    fail "a sessão é do usuário root ($CALLER_ARN). Use o login SSO: aws sso login --profile mini-banco && export AWS_PROFILE=mini-banco"
    exit 2
    ;;
esac
info "conta $ACCOUNT, região $REGION, identidade ${CALLER_ARN##*:assumed-role/}"

if command -v terraform >/dev/null 2>&1 && terraform version 2>/dev/null | head -1 | grep -q "v$TF_VERSION\$"; then
  TF_MODE=local
  info "terraform $TF_VERSION (local)"
else
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || {
    fail "nem terraform $TF_VERSION local nem Docker rodando"
    exit 2
  }
  TF_MODE=docker
  info "terraform $TF_VERSION (container)"
fi

BUCKET="mini-banco-tfstate-$ACCOUNT"
bucket_exists() { aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; }
if [ "$CMD" = "bootstrap" ]; then
  TF_REL="bootstrap"
  if [ -z "${TF_VAR_budget_email:-}" ]; then
    fail "defina TF_VAR_budget_email (alertas de custo; fora do git)"
    exit 2
  fi
elif ! bucket_exists; then
  fail "bucket de state $BUCKET não existe: rode ./scripts/lab.sh bootstrap primeiro"
  exit 2
fi
if [ "$CMD" = "up" ] && [ -z "${TF_VAR_alarm_email:-}" ]; then
  fail "defina TF_VAR_alarm_email (destino dos alarmes; fora do git)"
  exit 2
fi
mkdir -p "$LOG_DIR"
TAG="$(image_tag)"

if [ "$CMD" = "up" ] || [ "$CMD" = "down" ]; then
  must init "terraform init (state em s3://$BUCKET)" tf init -input=false -reconfigure -backend-config="bucket=$BUCKET"
fi

# ---------- up ----------
cmd_up() {
  if [ -n "${TF_VAR_github_token:-}" ]; then
    git -C "$ROOT" fetch -q origin master 2>/dev/null || true
    if ! git -C "$ROOT" merge-base --is-ancestor HEAD origin/master 2>/dev/null; then
      warn "HEAD não está no origin/master: o Amplify compila o front do GitHub, as imagens são do HEAD."
    fi
  else
    warn "sem TF_VAR_github_token: o lab sobe sem o front (Amplify)."
  fi

  if image_exists api "$TAG" && image_exists worker "$TAG"; then
    info "imagens $TAG já estão no ECR"
  elif [ "$PUSH" -eq 1 ]; then
    must push "Build e push das imagens ($TAG)" "$ROOT/scripts/push-images.sh"
  else
    fail "imagens $TAG (HEAD) não estão no ECR. Rode com --push (ou scripts/push-images.sh)."
    exit 2
  fi

  local auto=()
  [ "$YES" -eq 1 ] && auto=(-auto-approve)
  title "Infraestrutura"
  # 1º apply: services em 0. Os papéis do banco só ganham LOGIN na migration (ADR-0026).
  must apply-base "terraform apply (services em 0)" \
    tf apply -input=false ${auto[@]+"${auto[@]}"} -var "image_tag=$TAG" -var desired_count=0

  title "Aplicação"
  must migrate "Migration + LOGIN dos papéis (task mini-banco-lab-migrate)" "$ROOT/scripts/run-migration.sh"
  # Só desired_count muda em relação ao apply anterior (mesmas variáveis).
  must apply-scale "terraform apply (services em 1)" \
    tf apply -input=false -auto-approve -var "image_tag=$TAG" -var desired_count=1
  local cluster
  cluster="$(param cluster)"
  must stable "Esperar api e worker estáveis" \
    aws ecs wait services-stable --cluster "$cluster" --services api worker

  title "Smoke"
  local api_url alb
  api_url="$(param api-url)"
  alb="$(param alb-dns)"
  must smoke-cf "GET $api_url/health/ready = 200 (até ${CF_WAIT_SECONDS}s de propagação)" wait_http_200 "$api_url/health/ready"
  must smoke-auth "API pelo CloudFront sem key = 401" expect_code 401 "$api_url/v1/accounts/00000000-0000-7000-8000-000000000000"
  must smoke-alb "ALB direto NÃO responde (SG + header de origem, SEC-02)" alb_is_closed "http://$alb/health/ready"

  local app_id
  app_id="$(param amplify-app-id)"
  if [ "$app_id" != "none" ]; then
    must amplify "Disparar o build do front (Amplify)" \
      aws amplify start-job --app-id "$app_id" --branch-name master --job-type RELEASE --query jobSummary.jobId --output text
  fi

  summary
  printf '\n%s\n' "${GREEN}${BOLD}SUCESSO${RESET}${GREEN}: lab no ar (custa ~US\$ 0,10/h; './scripts/lab.sh down' no fim).${RESET}"
  info "API      $api_url   (key: secret mini-banco/lab/api-key)"
  if [ "$app_id" != "none" ]; then
    info "Front    $(tf output -raw amplify_url)   (build em andamento: ~5 min)"
    info "Senha    usuário lab, senha: (cd infra/envs/lab && terraform output -raw amplify_basic_auth_password)"
  fi
  info "Alarmes  confirme a assinatura SNS no e-mail (a cada apply)."
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1"; }

wait_http_200() {
  local deadline=$(($(date +%s) + CF_WAIT_SECONDS)) code
  while :; do
    code="$(http_code "$1")"
    echo "  $(date +%H:%M:%S) HTTP $code"
    [ "$code" = "200" ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 15
  done
}

expect_code() {
  local code
  code="$(http_code "$2")"
  echo "  HTTP $code (esperado $1)"
  [ "$code" = "$1" ]
}

# SG descarta o pacote: timeout (000). Qualquer resposta HTTP do ALB direto é falha de isolamento,
# exceto 403 (a trava do header ainda funcionaria, mas o SG deveria ter barrado antes).
alb_is_closed() {
  local code
  code="$(http_code "$1" 5)"
  echo "  HTTP $code (esperado 000: conexão descartada pelo sg-alb)"
  [ "$code" = "000" ]
}

# ---------- down ----------
cmd_down() {
  local auto=()
  [ "$YES" -eq 1 ] && auto=(-auto-approve)
  title "Destroy"
  # As variáveis obrigatórias não mudam o destroy; a tag só precisa ser válida.
  must destroy "terraform destroy" \
    tf destroy -input=false ${auto[@]+"${auto[@]}"} -var "image_tag=$TAG" -var desired_count=0 \
    -var "alarm_email=${TF_VAR_alarm_email:-destroy@example.invalid}"
  title "Conferência"
  if ! run_step leftovers "session-end-check (nada do lab pode sobrar)" "$ROOT/scripts/session-end-check.sh"; then
    info "A API de tagging pode atrasar; nova tentativa em 120 s..."
    sleep 120
    must leftovers "session-end-check (2ª tentativa)" "$ROOT/scripts/session-end-check.sh"
  fi
  summary
  printf '\n%s\n' "${GREEN}${BOLD}SUCESSO${RESET}${GREEN}: lab destruído; só o bootstrap continua (< US\$ 0,50/mês).${RESET}"
}

# ---------- bootstrap ----------
# Ovo e galinha (aws.md §4): o bucket do state é criado por este próprio root. Na 1ª vez, um
# override.tf temporário (gitignored) força state local; depois do apply ele sai e o state é
# migrado para o bucket. Interrompido no meio? Rodar de novo retoma pela migração.
OVERRIDE="$BOOTSTRAP_DIR/override.tf"
LOCAL_STATE="$BOOTSTRAP_DIR/terraform.tfstate"

cmd_bootstrap() {
  local auto=()
  [ "$YES" -eq 1 ] && auto=(-auto-approve)
  title "Bootstrap (infra/bootstrap)"
  # override.tf presente = o apply com state local ainda não terminou com sucesso (falhou ou foi
  # interrompido): aplica de novo (só cria o que falta) antes de migrar. Ele só sai depois do apply.
  if ! bucket_exists || [ -f "$OVERRIDE" ]; then
    if [ -f "$OVERRIDE" ]; then
      info "retomando: o apply anterior com state local não terminou"
    else
      info "bucket $BUCKET ainda não existe: 1º apply com state local"
    fi
    printf '%s\n' "# Gerado por scripts/lab.sh bootstrap: state local só até o bucket existir. Não versionar." \
      'terraform {' '  backend "local" {}' '}' >"$OVERRIDE"
    must init-local "terraform init (state local temporário)" tf init -input=false -reconfigure
    must apply-bootstrap "terraform apply (bucket de state, OIDC, ECR, budget)" \
      tf apply -input=false ${auto[@]+"${auto[@]}"}
  fi
  if [ -f "$OVERRIDE" ] || [ -f "$LOCAL_STATE" ]; then
    rm -f "$OVERRIDE"
    must migrate-state "Migrar o state local para s3://$BUCKET" \
      tf init -input=false -migrate-state -force-copy -backend-config="bucket=$BUCKET"
    must verify-state "Conferir o state no S3" tf state list
    # O state agora está no S3 (versionado). A cópia local fica só como backup gitignored.
    [ -f "$LOCAL_STATE" ] && mv "$LOCAL_STATE" "$LOCAL_STATE.local-backup"
    rm -f "$LOCAL_STATE.backup"
  else
    must init "terraform init (state em s3://$BUCKET)" \
      tf init -input=false -reconfigure -backend-config="bucket=$BUCKET"
    must apply-bootstrap "terraform apply (bootstrap)" tf apply -input=false ${auto[@]+"${auto[@]}"}
  fi
  summary
  printf '\n%s\n' "${GREEN}${BOLD}SUCESSO${RESET}${GREEN}: bootstrap aplicado; state em s3://$BUCKET/bootstrap/terraform.tfstate.${RESET}"
  info "Role do GitHub (fase 7): $(tf output -raw github_deploy_role_arn 2>/dev/null)"
  info "Próximo: confirme o e-mail do Cost Anomaly Detection, depois ./scripts/lab.sh up --push"
}

# ---------- status ----------
cmd_status() {
  local cluster
  if ! cluster="$(param cluster 2>/dev/null)"; then
    info "lab desligado (sem /mini-banco/lab/cluster no SSM)."
    exit 0
  fi
  aws ecs describe-services --cluster "$cluster" --services api worker \
    --query 'services[].[serviceName,desiredCount,runningCount,deployments[0].rolloutState]' --output table
  local api_url
  api_url="$(param api-url)"
  echo "health pelo CloudFront: HTTP $(http_code "$api_url/health/ready")  ($api_url)"
}

case "$CMD" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  bootstrap) cmd_bootstrap ;;
esac
