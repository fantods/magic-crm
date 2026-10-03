# Kubernetes manifests

Kustomize manifests that run the Magic CRM (Formless) containers on
Kubernetes: the API, the static web UI, and — for local clusters — PostgreSQL.
The stack is proven end to end on a local `kind` cluster; the `aws` overlay
adapts the same manifests to the Terraform stack in `infra/terraform`
(Milestone 10) without applying anything to a real cloud here.

## Layout

```text
infra/k8s/
├── kind-config.yaml        # kind cluster: ingress port mapping + ingress-ready label
├── base/                   # namespace, API, web, ingress, secret template
│   ├── namespace.yaml
│   ├── api-deployment.yaml     # probes on /api/v1/health, wait-for-postgres init
│   ├── api-service.yaml        # port 3000: apps/web/nginx.conf proxies to api:3000
│   ├── web-deployment.yaml     # nginx-unprivileged, probes on /healthz
│   ├── web-service.yaml
│   ├── ingress.yaml            # host formless.local -> web Service (which proxies /api/)
│   └── api-secrets.yaml        # OPENAI_API_KEY template, committed keyless (empty)
├── overlays/
│   ├── local/              # kind proof: in-cluster Postgres + MODEL_MODE=fake
│   └── aws/                # ECR images, RDS via secret, ALB ingress (documentation-grade)
└── scripts/
    └── local-verify.sh     # one command: cluster -> proof -> teardown
```

Design notes:

- **Images are parameterized per overlay.** The base uses neutral names
  (`formless-api`, `formless-web`); the local overlay pins them to the
  Milestone 9 images (`:latest`, loaded into kind), and the AWS overlay points
  at the ECR repositories Terraform created.
- **PostgreSQL lives in the local overlay, not in base** (Deployment + PVC,
  `strategy: Recreate` so a rolling update never tries to double-attach the
  RWO volume). The AWS overlay ships no database resources: the API reads
  `DATABASE_URL` from a secret holding the RDS connection string.
- **Probes use the existing health endpoints**: `/api/v1/health` for the API
  and `/healthz` for the web image. Database readiness is gated by the
  `wait-for-postgres` init container (`pg_isready` loop); the API entrypoint
  applies migrations before serving, so a Ready pod implies migrated schema.
- **Secret template is committed keyless.** `api-secrets.yaml` carries an
  empty `OPENAI_API_KEY`: the API then serves everything except ingestion and
  query (those answer 503), which is the documented no-key mode. The local
  overlay instead sets `MODEL_MODE=fake`, running the deterministic demo
  models so the full pipeline works with no key and no network. Never commit
  a real key; replace the secret at deploy time (commands below).
- **One origin.** The Ingress routes everything to the web Service; its nginx
  proxies `/api/` to the API Service, so the browser stays on one origin and
  CORS never comes into play.

## Run it locally (kind)

Prerequisites: Docker, `kind`, `kubectl` (kustomize is built in). Host port
80 must be free (the kind config maps it for the ingress controller).

```sh
# 1. Build the Milestone 9 images from the repository root
docker build -f apps/api/Dockerfile -t formless-api:latest .
docker build -f apps/web/Dockerfile -t formless-web:latest .

# 2. Create the cluster (maps node port 80 to localhost:80)
kind create cluster --name formless --config infra/k8s/kind-config.yaml

# 3. Load the images into the cluster
kind load docker-image formless-api:latest formless-web:latest --name formless
kind load docker-image postgres:16-alpine --name formless || true
#    (kind <=0.33 can print a spurious "content digest not found" for pulled
#     multi-arch images; `docker exec formless-control-plane crictl pull \
#     docker.io/library/postgres:16-alpine` finishes the job if needed)

# 4. Install ingress-nginx (pinned; matches the kind provider layout)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=420s

# 5. Apply the local overlay
kubectl apply -k infra/k8s/overlays/local

# 6. Wait for everything to become available
kubectl -n formless wait --for=condition=available \
  deploy/api deploy/web deploy/postgres --timeout=300s

# 7. Verify (all through the ingress, host formless.local)
curl -s -H 'Host: formless.local' http://localhost/api/v1/health
#   {"status":"ok","service":"formless-api","version":"0.1.0"}
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: formless.local' http://localhost/
#   200  (the demo UI)

# 7b. Optional: prove the keyless deterministic pipeline (MODEL_MODE=fake)
curl -s -X POST -H 'Content-Type: application/json' -H 'Host: formless.local' \
  http://localhost/api/v1/workspaces/ws-k8s-demo/ingestions \
  -d '{"subject":"Meridian Health expansion lead","body":"Meridian Health operates three clinics across Ontario and has a budget of 6500.","from":"ops@meridianhealth.example","to":"sales@magiccrm.example"}'
curl -s -X POST -H 'Content-Type: application/json' -H 'Host: formless.local' \
  http://localhost/api/v1/workspaces/ws-k8s-demo/query \
  -d '{"question":"Which leads have a budget over 5000?"}'
```

Or run the whole thing — create, load, apply, verify, tear down — with:

```sh
infra/k8s/scripts/local-verify.sh
```

Tear down when done:

```sh
kind delete cluster --name formless
```

## How the AWS overlay differs

`overlays/aws` reshapes the base for the Terraform stack (`infra/terraform`,
Milestone 10). It is documentation-grade: nothing here has been applied to a
real cluster, and applying it is a deliberate captain-gated step.

| Concern    | local (kind)                           | aws (EKS)                                                          |
| ---------- | -------------------------------------- | ------------------------------------------------------------------ |
| Images     | Milestone 9 images loaded into kind    | ECR repositories `<project>/api`, `<project>/web` (immutable tags) |
| Database   | In-cluster Postgres Deployment + PVC   | RDS (Terraform): `DATABASE_URL` from secret `formless-rds-url`     |
| DB wait    | `wait-for-postgres` init container     | Removed — no in-cluster `postgres` Service to poll                 |
| Model mode | `MODEL_MODE=fake`, no key needed       | Default `openai`; real key injected into `formless-api-secrets`    |
| Ingress    | ingress-nginx, host `formless.local`   | AWS Load Balancer Controller (`alb`), internal, target-type ip     |
| Storage    | kind's default `standard` StorageClass | none (no PVCs left)                                                |

Setup before applying (real values come from `terraform apply`; see the
header of `overlays/aws/kustomization.yaml` for the copy-paste sequence):

```sh
cd infra/k8s/overlays/aws
kustomize edit set image \
  formless-api=<account>.dkr.ecr.<region>.amazonaws.com/formless/api:<tag> \
  formless-web=<account>.dkr.ecr.<region>.amazonaws.com/formless/web:<tag>
kubectl -n formless create secret generic formless-rds-url \
  --from-literal=DATABASE_URL='postgresql://...'   # from SSM (see header)
kubectl -n formless create secret generic formless-api-secrets \
  --from-literal=OPENAI_API_KEY=sk-... --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k infra/k8s/overlays/aws
```

Rendering an overlay without touching a cluster:

```sh
kubectl kustomize infra/k8s/overlays/local
kubectl kustomize infra/k8s/overlays/aws
```

## Deliberately out of scope

- CI/CD pipelines and observability tooling (Milestone 12).
- Helm: Kustomize covers everything this milestone needs.
- Real cloud deployment, autoscaling (HPA), PDBs, TLS/ACME, service meshes.
  The AWS overlay documents the intended shape; wiring it for real is a
  follow-up.
