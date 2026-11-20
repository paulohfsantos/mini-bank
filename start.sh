#!/usr/bin/env bash
# start.sh: sobe e verifica o mini-banco inteiro de uma vez.
#
#   ./start.sh                 pré-requisitos → install → infra → migrations → todos os testes → pnpm dev
#   ./start.sh --no-dev        só verifica (igual ao CI) e sai com o código do resultado
#   ./start.sh --skip-tests    pré-requisitos → install → infra → migrations → pnpm dev
#   ./start.sh --keep-going    continua os testes mesmo se um falhar (resumo no final)
#   ./start.sh --help
#
# Cada etapa grava a saída completa em .logs/<etapa>.log. No sucesso mostra só ✔ e o tempo;
# na falha mostra as últimas linhas do log, o caminho dele e uma dica do que conferir.
# Código de saída: 0 tudo ok | 1 alguma etapa falhou | 2 pré-requisito ausente | 130 Ctrl+C.
# Compatível com o bash 3.2 do macOS.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 2
LOG_DIR="$ROOT/.logs"

RUN_TESTS=1
RUN_DEV=1
KEEP_GOING=0

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    --no-dev) RUN_DEV=0 ;;
    --skip-tests) RUN_TESTS=0 ;;
    --keep-going) KEEP_GOING=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "opção desconhecida: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

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

# Resultados (arrays indexados: o bash 3.2 não tem arrays associativos).
STEP_NAMES=()
STEP_STATUS=() # ok | falhou | pulado
STEP_SECONDS=()
FAILED=0
STARTED_AT=$(date +%s)

record() {
  STEP_NAMES+=("$1")
  STEP_STATUS+=("$2")
  STEP_SECONDS+=("$3")
}

summary() {
  title "Resumo"
  # bash 3.2 + set -u: expandir um array vazio é erro (Ctrl+C antes da primeira etapa).
  if [ "${#STEP_NAMES[@]}" -eq 0 ]; then
    info "  nenhuma etapa executada"
    return
  fi
  local i
  for i in "${!STEP_NAMES[@]}"; do
    # Tempo antes do nome: printf alinha por bytes e os nomes têm acentos (multibyte).
    case "${STEP_STATUS[$i]}" in
      ok) printf '  %s✔%s %4ss  %s\n' "$GREEN" "$RESET" "${STEP_SECONDS[$i]}" "${STEP_NAMES[$i]}" ;;
      falhou) printf '  %s✖ %4ss  %s%s\n' "$RED" "${STEP_SECONDS[$i]}" "${STEP_NAMES[$i]}" "$RESET" ;;
      *) printf '  %s-     -  %s (pulado)%s\n' "$DIM" "${STEP_NAMES[$i]}" "$RESET" ;;
    esac
  done
  printf '  %s(total: %ss, logs em .logs/)%s\n' "$DIM" "$(($(date +%s) - STARTED_AT))" "$RESET"
}

on_interrupt() {
  printf '\n'
  warn "interrompido (Ctrl+C)"
  summary
  exit 130
}
trap on_interrupt INT TERM

# Dica por etapa quando falha.
hint_for() {
  case "$1" in
    install) echo "Lockfile desatualizado? Rode 'pnpm install' e confira o diff do pnpm-lock.yaml." ;;
    infra) echo "Portas 5432/9324/16686 ocupadas? 'docker compose ps' e 'pnpm infra:check'. Volume velho: 'pnpm infra:reset'." ;;
    migrate) echo "Postgres de pé? 'pnpm infra:check'. Migration com erro: veja o SQL citado no log." ;;
    check) echo "Lint/format/typecheck/unit/specs. 'pnpm lint:fix' e 'pnpm format' resolvem estilo; o resto está no log." ;;
    integration | e2e) echo "Testcontainers precisa do Docker rodando. Rode só o arquivo citado: 'pnpm vitest run --project <projeto> <arquivo>'." ;;
    web) echo "Playwright: 'apps/web/playwright-report/' tem o relatório; 'pnpm --filter @mini-banco/web exec playwright install chromium' se faltar o navegador." ;;
    *) echo "Veja o log completo." ;;
  esac
}

# run_step <id> <nome> <comando...>: executa, mede, grava log e registra o resultado.
run_step() {
  local id="$1" name="$2"
  shift 2
  local log="$LOG_DIR/$id.log" start end status
  printf '%s▶%s %s %s(%s)%s\n' "$BOLD" "$RESET" "$name" "$DIM" "$*" "$RESET"
  start=$(date +%s)
  "$@" >"$log" 2>&1
  status=$?
  end=$(date +%s)
  if [ "$status" -eq 0 ]; then
    printf '  %s✔ ok%s %s(%ss)%s\n' "$GREEN" "$RESET" "$DIM" "$((end - start))" "$RESET"
    record "$name" ok "$((end - start))"
    return 0
  fi
  printf '  %s✖ falhou (código %s, %ss)%s\n' "$RED" "$status" "$((end - start))" "$RESET"
  printf '%s' "$DIM"
  tail -n 30 "$log" | sed 's/^/    │ /'
  printf '%s' "$RESET"
  printf '    log completo: %s\n' "${log#"$ROOT"/}"
  printf '    %sdica:%s %s\n' "$YELLOW" "$RESET" "$(hint_for "$id")"
  record "$name" falhou "$((end - start))"
  FAILED=1
  return 1
}

# Interrompe o script (com resumo) se a etapa falhar e não for para continuar.
PLANNED=()
must() {
  run_step "$@" && return 0
  # Etapas planejadas que não chegaram a rodar aparecem como puladas no resumo.
  local name done_name found
  for name in "${PLANNED[@]}"; do
    found=0
    for done_name in "${STEP_NAMES[@]}"; do [ "$done_name" = "$name" ] && found=1; done
    [ "$found" -eq 0 ] && skip "$name"
  done
  summary
  printf '\n%s\n' "${RED}${BOLD}FALHOU${RESET}${RED}: corrija a etapa acima e rode de novo.${RESET}"
  exit 1
}

skip() { record "$1" pulado 0; }

# ---------- pré-requisitos ----------

title "Pré-requisitos"

# Node pela versão do .nvmrc (fnm, se instalado).
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)" >/dev/null 2>&1
  fnm use --silent-if-unchanged >/dev/null 2>&1 || fnm use >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null 2>&1; then
  fail "Node não encontrado. Instale a versão do .nvmrc ($(cat .nvmrc)), ex.: 'fnm install'."
  exit 2
fi
wanted_node="$(tr -d '[:space:]v' <.nvmrc)"
current_node="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$current_node" != "${wanted_node%%.*}" ]; then
  fail "Node $current_node em uso, o projeto pede $wanted_node (.nvmrc). Rode 'fnm use' (ou nvm use)."
  exit 2
fi
info "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm não encontrado. Rode 'corepack enable' (usa a versão do campo packageManager)."
  exit 2
fi
info "pnpm $(pnpm -v)"

# Docker Desktop no macOS instala o CLI em ~/.docker/bin.
[ -d "$HOME/.docker/bin" ] && PATH="$HOME/.docker/bin:$PATH"
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker não encontrado. Instale o Docker Desktop."
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  fail "O Docker está instalado, mas o daemon não responde. Abra o Docker Desktop e espere ficar 'running'."
  exit 2
fi
info "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env não existia: criado a partir do .env.example (só valores de laboratório)."
fi

mkdir -p "$LOG_DIR"

# ---------- setup ----------

PLANNED=(
  "Instalar dependências"
  "Subir infra (Postgres, SQS, Jaeger)"
  "Aplicar migrations"
)
if [ "$RUN_TESTS" -eq 1 ]; then
  PLANNED+=(
    "Lint, format, typecheck, unit, specs"
    "Testes de integração"
    "Testes e2e (API + telemetria)"
    "Testes do front (Playwright)"
  )
fi

title "Setup"
must install "Instalar dependências" pnpm install --frozen-lockfile
must infra "Subir infra (Postgres, SQS, Jaeger)" pnpm infra:up
must migrate "Aplicar migrations" pnpm db:migrate

# ---------- testes ----------

if [ "$RUN_TESTS" -eq 1 ]; then
  title "Verificação (o mesmo que o CI)"
  step() { if [ "$KEEP_GOING" -eq 1 ]; then run_step "$@"; else must "$@"; fi; }
  step check "Lint, format, typecheck, unit, specs" pnpm check
  step integration "Testes de integração" pnpm test:integration
  step e2e "Testes e2e (API + telemetria)" pnpm test:e2e
  step web "Testes do front (Playwright)" pnpm test:web
else
  skip "Lint, format, typecheck, unit, specs"
  skip "Testes de integração"
  skip "Testes e2e (API + telemetria)"
  skip "Testes do front (Playwright)"
fi

summary

if [ "$FAILED" -ne 0 ]; then
  printf '\n%s\n' "${RED}${BOLD}FALHOU${RESET}${RED}: há etapas com erro (veja acima). O app não foi iniciado.${RESET}"
  exit 1
fi

if [ "$RUN_DEV" -eq 0 ]; then
  printf '\n%s\n' "${GREEN}${BOLD}SUCESSO${RESET}${GREEN}: tudo verde.${RESET}"
  exit 0
fi

# ---------- app ----------

busy=""
for port in 3000 3001 3002 9464 9465; do
  if lsof -iTCP:"$port" -sTCP:LISTEN -nP >/dev/null 2>&1; then busy="$busy $port"; fi
done
if [ -n "$busy" ]; then
  fail "Portas em uso:$busy. Já existe um 'pnpm dev' rodando? Pare-o e rode de novo."
  exit 1
fi

printf '\n%s\n' "${GREEN}${BOLD}SUCESSO${RESET}${GREEN}: subindo o app (Ctrl+C para parar).${RESET}"
info "web      http://localhost:3000"
info "api      http://localhost:3001  (docs: /docs, health: /health/ready)"
info "worker   health http://localhost:3002/health/ready"
info "jaeger   http://localhost:16686"
info "métricas http://localhost:9464/metrics (api), http://localhost:9465/metrics (worker)"
trap - INT TERM
exec pnpm dev
