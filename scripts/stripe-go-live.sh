#!/usr/bin/env bash
# Interactive Stripe live-mode cutover for TB-Backend (the only place Stripe keys live:
# the website uses hosted checkout via the backend, the mobile app has no Stripe).
#
#   bash scripts/stripe-go-live.sh            plan -> confirm -> apply -> restart -> verify
#   bash scripts/stripe-go-live.sh --verify   just check the live config on the server
#
# Keys are read with hidden input and sent over SSH stdin — never echoed, never
# passed as arguments (so they don't show up in shell history or `ps`).
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/weshuber.pem}"
HOST="${HOST:-ubuntu@174.129.64.158}"
APP_DIR=/home/ubuntu/TB-Backend
REMOTE_JS=.stripe-go-live.tmp.js
WEBHOOK_URL=https://api.thetrickbook.com/api/payments/webhook
HERE="$(cd "$(dirname "$0")" && pwd)"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
remote() { ssh -T -i "$SSH_KEY" -o ConnectTimeout=10 "$HOST" ". ~/.nvm/nvm.sh >/dev/null 2>&1; cd $APP_DIR && $*"; }
cleanup() { remote "rm -f $REMOTE_JS" >/dev/null 2>&1 || true; unset SK WHSEC; }
trap cleanup EXIT

bold "Uploading helper to $HOST"
scp -q -i "$SSH_KEY" "$HERE/stripe-go-live-remote.js" "$HOST:$APP_DIR/$REMOTE_JS"

verify() {
  bold "Verifying server config"
  remote "node $REMOTE_JS --verify"
  bold "Probing live webhook (expect a signature error = raw body reaches verification)"
  curl -s -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' \
    -H 'stripe-signature: t=1,v1=invalid' -d '{}' | head -c 200
  echo
}

if [[ "${1:-}" == "--verify" ]]; then verify; exit; fi

cat <<'EOF'

Stripe live cutover
-------------------
You need: Dashboard (LIVE mode) -> Developers -> API keys -> Secret key (sk_live_...)
          or a restricted key (rk_live_...) with write access to Products, Prices,
          Webhook Endpoints, Customers, Checkout Sessions, Subscriptions.
EOF

read -rsp $'\nPaste live secret key (hidden): ' SK; echo
[[ "$SK" =~ ^(sk|rk)_live_[A-Za-z0-9]+$ ]] || { echo "That doesn't look like a live secret key. Aborting."; exit 1; }
echo "Got ${SK:0:8}…${SK: -4}"

bold "Dry run"
PLAN="$(printf '{"key":"%s"}' "$SK" | remote "node $REMOTE_JS --plan")"
echo "$PLAN" | grep -v '^WEBHOOK_EXISTS$'

WHSEC=""
if grep -q '^WEBHOOK_EXISTS$' <<<"$PLAN"; then
  echo
  echo "A live webhook endpoint for $WEBHOOK_URL already exists; Stripe only reveals its"
  echo "signing secret in the dashboard: Developers -> Webhooks -> endpoint -> Signing secret -> Reveal."
  read -rsp 'Paste its signing secret (hidden): ' WHSEC; echo
  [[ "$WHSEC" =~ ^whsec_[A-Za-z0-9]+$ ]] || { echo "Not a whsec_ secret. Aborting."; exit 1; }
fi

echo
read -rp "Apply these changes to PRODUCTION and restart TB-Backend? [y/N] " OK
[[ "$OK" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 0; }

bold "Applying"
printf '{"key":"%s","whsec":"%s"}' "$SK" "$WHSEC" | remote "node $REMOTE_JS --apply"
unset SK WHSEC

bold "Restarting TB-Backend"
remote "pm2 restart TB-Backend >/dev/null && sleep 4 && pm2 describe TB-Backend | grep -E ' status | restarts '"

verify

bold "Done. Next: buy it once for real on https://thetrickbook.com/settings?tab=billing,"
echo "confirm premium activates, then refund yourself from the Stripe dashboard."
