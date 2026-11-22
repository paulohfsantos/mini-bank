#!/usr/bin/env bash
# Verificação estática do Terraform (fase 6), sem credenciais e sem tocar na AWS:
#   fmt -check → init -backend=false + validate (cada root) → terraform test (provider simulado,
#   asserções com IDs de risco) → tflint → trivy config.
# Ferramentas em containers com versão fixa (mesmas no CI): nada a instalar na máquina.
# Uso: pnpm infra:lint   (ou ./scripts/infra-lint.sh --fix para aplicar o terraform fmt)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TERRAFORM_IMAGE="hashicorp/terraform:$(tr -d '[:space:]' <"$ROOT/infra/.terraform-version")"
TFLINT_IMAGE="ghcr.io/terraform-linters/tflint:v0.65.0"
TRIVY_IMAGE="aquasec/trivy:0.76.2"
ROOTS=(bootstrap envs/lab)

[ -d "$HOME/.docker/bin" ] && PATH="$HOME/.docker/bin:$PATH"
docker info >/dev/null 2>&1 || { echo "Docker não responde: abra o Docker Desktop." >&2; exit 2; }

# Cache de providers e plugins fora do repo versionado (gitignored).
CACHE="$ROOT/infra/.cache"
mkdir -p "$CACHE/plugins" "$CACHE/tflint" "$CACHE/trivy"

tf() {
  docker run --rm -v "$ROOT/infra:/infra" -v "$CACHE/plugins:/plugins" \
    -e TF_PLUGIN_CACHE_DIR=/plugins -e TF_IN_AUTOMATION=1 -w "/infra/$1" "$TERRAFORM_IMAGE" "${@:2}"
}

if [ "${1:-}" = "--fix" ]; then
  tf . fmt -recursive
  exit 0
fi

echo "▶ terraform fmt -check"
tf . fmt -check -recursive -diff

for root in "${ROOTS[@]}"; do
  echo "▶ terraform validate ($root)"
  tf "$root" init -backend=false -input=false -no-color >/dev/null
  tf "$root" validate -no-color
done

# terraform test: cada diretório com tests/*.tftest.hcl (módulos e roots), só com mock_provider.
echo "▶ terraform test"
failed=0
for dir in $(cd "$ROOT/infra" && find . -path ./.cache -prune -o -name '*.tftest.hcl' -print | xargs -n1 dirname | xargs -n1 dirname | sort -u); do
  dir="${dir#./}"
  tf "$dir" init -backend=false -input=false -no-color >/dev/null
  if out="$(tf "$dir" test -no-color 2>&1)"; then
    printf '  ✔ %-28s %s\n' "$dir" "$(printf '%s\n' "$out" | grep -E '^Success' | sed 's/Success! //')"
  else
    printf '  ✖ %s\n%s\n' "$dir" "$out"
    failed=1
  fi
done
[ "$failed" -eq 0 ] || exit 1

echo "▶ tflint"
docker run --rm -v "$ROOT/infra:/infra" -v "$CACHE/tflint:/root/.tflint.d" -w /infra \
  -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" --entrypoint sh "$TFLINT_IMAGE" -c \
  'tflint --init --config /infra/.tflint.hcl >/dev/null && tflint --recursive --config /infra/.tflint.hcl --format compact'

echo "▶ trivy config (HIGH/CRITICAL; exceções justificadas em infra/.trivyignore.yaml)"
docker run --rm -v "$ROOT/infra:/infra:ro" -v "$CACHE/trivy:/root/.cache/trivy" "$TRIVY_IMAGE" \
  config --quiet --exit-code 1 --severity HIGH,CRITICAL \
  --ignorefile /infra/.trivyignore.yaml --skip-dirs '**/.terraform' /infra

echo "✔ infra ok"
