#!/usr/bin/env bash
#
# deploy.sh — Build local (Colima, buildx, linux/amd64) → push GHCR → tự rollout k3s.
#
# VPS là x86_64 (amd64) nên BẮT BUỘC build --platform linux/amd64 (máy Mac arm64).
# Backend (NestJS): docker build tự `npm run build` = gate type-check.
#
# Dùng:
#   ./deploy.sh              # build amd64 + push :latest và :<sha> → rollout deploy/backend
#   ./deploy.sh --no-latest  # CHỈ build + push :<sha> (KHÔNG rollout). Dùng test.
#
# Creds GHCR: GHCR_TOKEN (PAT write:packages) hoặc `gh auth token`; GHCR_USER tuỳ chọn.
#
set -euo pipefail

IMAGE="ghcr.io/cucquy/cucquy-backend"
VPS="rice@ssh.ricevps.xyz"
NS="cucquy"; DEPLOY="backend"
DEPLOY_DIR="~/deploys/cucquy-backend"
BUILDER="cucquy-xbuild"

PUSH_LATEST=1
for arg in "$@"; do
  case "$arg" in
    --no-latest) PUSH_LATEST=0 ;;
    -h|--help)   sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "❌ Tham số lạ: $arg" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")"
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

# 1. Docker / buildx builder
docker info >/dev/null 2>&1 || { red "❌ Docker (Colima) chưa chạy. colima start"; exit 1; }
docker buildx inspect "$BUILDER" >/dev/null 2>&1 || {
  blue "→ tạo buildx builder $BUILDER (docker-container)..."
  docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null
}
green "✓ Docker + buildx OK"

# 2. Commit
SHA="$(git rev-parse --short HEAD)"; FULL_SHA="$(git rev-parse HEAD)"
MSG="$(git log -1 --pretty=format:'%s')"; AUTHOR="$(git log -1 --pretty=format:'%an')"
TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
blue "→ Commit: $SHA  ($MSG)"

# 3. Login GHCR
GHCR_USER="${GHCR_USER:-$(git config user.name 2>/dev/null | tr '[:upper:] ' '[:lower:]_')}"; GHCR_USER="${GHCR_USER:-cucquy}"
TOKEN="${GHCR_TOKEN:-}"; [ -z "$TOKEN" ] && command -v gh >/dev/null 2>&1 && TOKEN="$(gh auth token 2>/dev/null || true)"
[ -n "$TOKEN" ] || { red "❌ Không có GHCR creds. export GHCR_TOKEN=<PAT write:packages> hoặc gh auth login"; exit 1; }
echo "$TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null && green "✓ Login GHCR OK (user: $GHCR_USER)"

# 4. Build + push (linux/amd64; docker build chạy `npm run build` = gate)
TAGS=(-t "$IMAGE:$SHA"); [ "$PUSH_LATEST" -eq 1 ] && TAGS+=(-t "$IMAGE:latest")
blue "→ buildx build --platform linux/amd64 --push..."
docker buildx build --builder "$BUILDER" --platform linux/amd64 "${TAGS[@]}" --push .
green "✓ Build + push OK (linux/amd64)"

# 5. Record lên VPS
KIND="deploy"; [ "$PUSH_LATEST" -eq 1 ] || KIND="test"
RECORD=$(printf '{"commit":"%s","short":"%s","message":%s,"author":%s,"time":"%s","image":"%s:%s","status":"pushed","kind":"%s"}' \
  "$FULL_SHA" "$SHA" \
  "$(printf '%s' "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$AUTHOR" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$TIME" "$IMAGE" "$SHA" "$KIND")
printf '%s\n' "$RECORD" | ssh -o ConnectTimeout=10 "$VPS" "mkdir -p $DEPLOY_DIR && cat >> $DEPLOY_DIR/history.jsonl" \
  && green "✓ Record ($KIND) → $DEPLOY_DIR/history.jsonl" || red "⚠ Không ghi được record (push vẫn OK)."

# 6. Rollout chủ động (option 1)
echo
if [ "$PUSH_LATEST" -eq 1 ]; then
  blue "→ kubectl set image deploy/$DEPLOY → :$SHA + rollout..."
  ssh -o ConnectTimeout=15 "$VPS" "export KUBECONFIG=\$HOME/.kube/config
    CN=\$(kubectl -n $NS get deploy $DEPLOY -o jsonpath='{.spec.template.spec.containers[0].name}')
    kubectl -n $NS set image deploy/$DEPLOY \"\$CN=$IMAGE:$SHA\"
    kubectl -n $NS rollout status deploy/$DEPLOY --timeout=300s"
  green "🚀 Đã rollout deploy/$DEPLOY → $IMAGE:$SHA (linux/amd64)"
else
  green "🧪 Đã push CHỈ :$SHA (KHÔNG rollout). Prod giữ nguyên."
fi
