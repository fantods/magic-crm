#!/usr/bin/env sh
# Proves the Milestone 11 Kubernetes manifests on a local kind cluster:
# builds/loads the Milestone 9 images, installs ingress-nginx, applies the
# local overlay, and verifies pods Ready, web serving, API health, and the
# keyless deterministic ingestion + query path. Tears the cluster down at
# the end unless KEEP_CLUSTER=1.
#
# Prerequisites: docker, kind, kubectl; free host port 80.
# Usage: infra/k8s/scripts/local-verify.sh [--skip-build]
set -eu

cd "$(dirname "$0")/../../.."   # repository root
INGRESS_HOST=${INGRESS_HOST:-formless.local}
CLUSTER=formless

say() { printf '\n=== %s\n' "$1"; }

[ "${1:-}" = "--skip-build" ] || {
  say "Building Milestone 9 images"
  docker build -f apps/api/Dockerfile -t formless-api:latest .
  docker build -f apps/web/Dockerfile -t formless-web:latest .
}

say "Creating kind cluster"
kind create cluster --name "$CLUSTER" --config infra/k8s/kind-config.yaml

say "Loading images into the cluster"
kind load docker-image formless-api:latest formless-web:latest --name "$CLUSTER"
# kind <=0.33 can fail (spuriously) on pulled multi-arch images; make sure
# Postgres is present in the node either way.
kind load docker-image postgres:16-alpine --name "$CLUSTER" || \
  docker exec "${CLUSTER}-control-plane" crictl pull docker.io/library/postgres:16-alpine

say "Installing ingress-nginx"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=420s

say "Applying infra/k8s/overlays/local"
kubectl apply -k infra/k8s/overlays/local
kubectl -n formless wait --for=condition=available \
  deploy/api deploy/web deploy/postgres --timeout=300s

fail() {
  echo "FAIL: $1" >&2
  kubectl get pods -n formless -o wide >&2 || true
  exit 1
}

say "Verifying"
curl -fsS -H "Host: $INGRESS_HOST" http://localhost/api/v1/health | grep -q '"status":"ok"' \
  || fail "API health did not answer ok through the ingress"
curl -fsS -o /dev/null -H "Host: $INGRESS_HOST" http://localhost/ \
  || fail "web UI did not serve through the ingress"
INGESTION=$(curl -fsS -X POST -H 'Content-Type: application/json' -H "Host: $INGRESS_HOST" \
  http://localhost/api/v1/workspaces/ws-k8s-verify/ingestions \
  -d '{"subject":"Meridian Health expansion lead","body":"Meridian Health operates three clinics across Ontario and has a budget of 6500.","from":"ops@meridianhealth.example","to":"sales@magiccrm.example"}')
echo "$INGESTION" | grep -q '"status":"completed"' \
  || fail "keyless deterministic ingestion did not complete: $INGESTION"
QUERY=$(curl -fsS -X POST -H 'Content-Type: application/json' -H "Host: $INGRESS_HOST" \
  http://localhost/api/v1/workspaces/ws-k8s-verify/query \
  -d '{"question":"Which leads have a budget over 5000?"}')
echo "$QUERY" | grep -q '"records":\[' \
  || fail "keyless deterministic query did not answer: $QUERY"

kubectl get pods -n formless
say "All checks passed"
if [ "${KEEP_CLUSTER:-0}" = "1" ]; then
  echo "KEEP_CLUSTER=1: leaving the cluster running (context kind-$CLUSTER)."
else
  say "Tearing down the kind cluster"
  kind delete cluster --name "$CLUSTER"
fi
