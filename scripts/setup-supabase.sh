#!/usr/bin/env bash
# Set up (or update) a Supabase project for SASU Invoice, end to end.
#
#   Needs only a personal access token (supabase.com → Account → Access Tokens),
#   in .env.local as SUPABASE_ACCESS_TOKEN=… or in the environment.
#
#   scripts/setup-supabase.sh                 # create "sasu-staging" in London, or reuse SUPABASE_PROJECT_REF
#   PROJECT_NAME=sasu-production scripts/setup-supabase.sh
#
# It creates the project if needed, writes the keys to .env.local (mode 600),
# applies all migrations, sets function secrets, deploys every Edge Function
# (bundled server-side; no Docker), pushes auth settings, and schedules the
# reminder/recurring worker. Safe to re-run: every step is idempotent.
# Secrets are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.local
SB="${SUPABASE_BIN:-supabase}"
log() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Load .env.local without echoing anything.
if [[ -f $ENV_FILE ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

[[ -n ${SUPABASE_ACCESS_TOKEN:-} ]] || die "Add SUPABASE_ACCESS_TOKEN=… to $ENV_FILE (supabase.com → Account → Access Tokens)."
export SUPABASE_ACCESS_TOKEN
command -v "$SB" >/dev/null || die "Supabase CLI not found (brew install supabase)."
command -v jq >/dev/null || die "jq not found (brew install jq)."

PROJECT_NAME="${PROJECT_NAME:-sasu-staging}"
REGION="${SUPABASE_REGION:-eu-west-2}"          # London
APP_URL="${APP_URL:-https://sasuinvoice.netlify.app}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$APP_URL,http://localhost:5173,http://localhost:4173}"

# Write or replace KEY=value in .env.local, keeping everything else.
set_env() {
  local key=$1 value=$2
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -q "^$key=" "$ENV_FILE"; then
    local tmp
    tmp=$(mktemp)
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  export "$key=$value"
}

api() { # Supabase Management API
  curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' "$@"
}

# 1. Project -------------------------------------------------------------------------
if [[ -z ${SUPABASE_PROJECT_REF:-} ]]; then
  existing=$("$SB" projects list -o json | jq -r --arg n "$PROJECT_NAME" '.[] | select(.name==$n) | .id' | head -1)
  if [[ -n $existing ]]; then
    die "A project named $PROJECT_NAME already exists ($existing). Put SUPABASE_PROJECT_REF=$existing and SUPABASE_DB_PASSWORD=… in $ENV_FILE to reuse it."
  fi
  orgs=$("$SB" orgs list -o json)
  ORG_ID="${SUPABASE_ORG_ID:-$(jq -r 'if length==1 then .[0].id else empty end' <<<"$orgs")}"
  [[ -n $ORG_ID ]] || die "You have several Supabase organizations; set SUPABASE_ORG_ID. Options: $(jq -r '[.[]|.id+" ("+.name+")"]|join(", ")' <<<"$orgs")"
  [[ -n ${SUPABASE_DB_PASSWORD:-} ]] || set_env SUPABASE_DB_PASSWORD "$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 32)"
  log "Creating project $PROJECT_NAME in $REGION (free/micro size)…"
  ref=$("$SB" projects create "$PROJECT_NAME" --org-id "$ORG_ID" --db-password "$SUPABASE_DB_PASSWORD" \
        --region "$REGION" -o json | jq -r '.id // .ref')
  [[ -n $ref && $ref != null ]] || die "Project creation did not return a project ref."
  set_env SUPABASE_PROJECT_REF "$ref"
fi
REF=$SUPABASE_PROJECT_REF
[[ -n ${SUPABASE_DB_PASSWORD:-} ]] || die "Set SUPABASE_DB_PASSWORD for project $REF in $ENV_FILE."
export SUPABASE_DB_PASSWORD

log "Waiting for project $REF to be ready…"
for _ in $(seq 1 60); do
  status=$(api "https://api.supabase.com/v1/projects/$REF" | jq -r '.status')
  [[ $status == ACTIVE_HEALTHY ]] && break
  sleep 10
done
[[ $status == ACTIVE_HEALTHY ]] || die "Project not ready (status: $status). Re-run in a few minutes."

# 2. Keys → .env.local ------------------------------------------------------------------
keys=$("$SB" projects api-keys --project-ref "$REF" --reveal -o json)
anon=$(jq -r '[.[] | select(.name=="anon" or .type=="publishable")][0].api_key' <<<"$keys")
service=$(jq -r '[.[] | select(.name=="service_role")][0].api_key' <<<"$keys")
[[ -n $anon && $anon != null ]] || die "Could not read the anon key."
set_env VITE_SUPABASE_URL "https://$REF.supabase.co"
set_env VITE_SUPABASE_ANON_KEY "$anon"
[[ -n $service && $service != null ]] && set_env SUPABASE_SERVICE_ROLE_KEY "$service"
log "Keys saved to $ENV_FILE (not committed)."

# 3. Database ------------------------------------------------------------------------------
log "Linking and applying migrations…"
"$SB" link --project-ref "$REF" -p "$SUPABASE_DB_PASSWORD" --yes >/dev/null
"$SB" db push --linked --yes

# 4. Function secrets & deploy ------------------------------------------------------------------
[[ -n ${WORKER_SECRET:-} ]] || set_env WORKER_SECRET "$(openssl rand -hex 32)"
secrets=(ALLOWED_ORIGINS="$ALLOWED_ORIGINS" APP_URL="$APP_URL" WORKER_SECRET="$WORKER_SECRET")
for k in RESEND_API_KEY EMAIL_FROM_ADDRESS RESEND_WEBHOOK_SECRET OPENAI_API_KEY OPENAI_MODEL \
         PADDLE_API_KEY PADDLE_ENVIRONMENT PADDLE_WEBHOOK_SECRET; do
  [[ -n ${!k:-} ]] && secrets+=("$k=${!k}")
done
log "Setting ${#secrets[@]} function secrets…"
"$SB" secrets set --project-ref "$REF" "${secrets[@]}" >/dev/null

log "Deploying Edge Functions (server-side bundling)…"
npm run --silent functions:sync >/dev/null
"$SB" functions deploy --project-ref "$REF" --use-api --yes

# 5. Auth settings ------------------------------------------------------------------------------
log "Pushing auth settings from supabase/config.toml…"
"$SB" config push --project-ref "$REF" --yes >/dev/null || log "config push failed; check Auth → URL configuration in the dashboard."

# 6. Scheduler (pg_cron → reminder-worker every 5 minutes) ---------------------------------------
log "Scheduling the reminder / recurring worker…"
sql=$(cat <<SQL
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://$REF.supabase.co/functions/v1/reminder-worker', 'recoverflow_worker_url')
  where not exists (select 1 from vault.secrets where name = 'recoverflow_worker_url');
select vault.create_secret('$WORKER_SECRET', 'recoverflow_worker_secret')
  where not exists (select 1 from vault.secrets where name = 'recoverflow_worker_secret');
select vault.update_secret((select id from vault.secrets where name = 'recoverflow_worker_secret'), '$WORKER_SECRET');
select cron.unschedule('recoverflow-worker') where exists (select 1 from cron.job where jobname = 'recoverflow-worker');
select cron.schedule('recoverflow-worker', '*/5 * * * *', \$cron\$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'recoverflow_worker_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recoverflow_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
\$cron\$);
SQL
)
api -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -d "$(jq -n --arg q "$sql" '{query: $q}')" >/dev/null

# 7. Health -------------------------------------------------------------------------------------------
log "Checking the health endpoint…"
sleep 5
health=$(curl -s -o /dev/null -w '%{http_code}' "https://$REF.supabase.co/functions/v1/health" || true)
echo "  health: HTTP $health (503 is expected until the scheduler's first run, within 5 minutes)"

log "Done. Project: https://supabase.com/dashboard/project/$REF"
echo "  Next: npm run dev → http://localhost:5173/dashboard/register"
