#!/usr/bin/env bash
# Tag (git sha) mais recente presente nos DOIS repositórios do ECR: entra no
# `terraform apply -var image_tag=...`. Falha se não houver imagem comum.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
tags() {
  aws --region "$REGION" ecr describe-images --repository-name "mini-banco/$1" \
    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[].imageTags[0]' --output text | tr '\t' '\n' | grep -v '^None$'
}
api="$(tags api)"
# Mais recente primeiro (o push sobe api e worker com a mesma tag).
for t in $(tags worker); do
  if printf '%s\n' "$api" | grep -qx "$t"; then echo "$t"; exit 0; fi
done
echo "nenhuma tag em comum entre mini-banco/api e mini-banco/worker: rode scripts/push-images.sh" >&2
exit 1
