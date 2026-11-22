#!/usr/bin/env bash
# Deploy manual de imagem (fase 6; na fase 7 o deploy.yml faz isto pelo OIDC):
# build ARM64 das imagens api e worker com a tag = git sha do HEAD e push para o ECR.
#   AWS_PROFILE=mini-banco ./scripts/push-images.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
cd "$ROOT"
[ -d "$HOME/.docker/bin" ] && PATH="$HOME/.docker/bin:$PATH"

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree com mudanças: a tag é o git sha, então a imagem precisa ser o commit exato." >&2
  exit 1
fi
TAG="$(git rev-parse --short=12 HEAD)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
for app in api worker; do
  echo "▶ $app:$TAG"
  docker buildx build --platform linux/arm64 --target "$app" --build-arg "APP=$app" \
    --provenance=false -t "$REGISTRY/mini-banco/$app:$TAG" --push .
done
echo "$TAG"
