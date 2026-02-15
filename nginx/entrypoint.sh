#!/bin/sh
set -e

DOMAIN="share-cost.site"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

# ── Bootstrap: obtain certificate if it doesn't exist yet ────────────────────
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "[entrypoint] No certificate for $DOMAIN — starting HTTP-only nginx for ACME challenge…"
  # Start nginx with the minimal HTTP-only config so certbot can use webroot
  nginx -c /etc/nginx/nginx-init.conf -g "daemon on;"
  sleep 2

  certbot certonly --webroot -w /var/www/certbot \
    --email admin@$DOMAIN \
    --agree-tos --no-eff-email \
    -d "$DOMAIN" \
    --non-interactive

  echo "[entrypoint] Certificate obtained. Stopping bootstrap nginx…"
  nginx -s stop
  sleep 1
fi

# ── Start nginx with full HTTPS config ───────────────────────────────────────
echo "[entrypoint] Starting nginx with HTTPS…"
nginx -g "daemon off;" &
NGINX_PID=$!

# Renew certs twice daily (certbot is a no-op if not near expiry)
(
  while true; do
    sleep 12h
    certbot renew --quiet
    nginx -s reload
  done
) &

wait $NGINX_PID
