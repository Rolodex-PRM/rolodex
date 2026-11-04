#!/bin/sh
set -e
i=0
while [ ! -s /certs/fullchain.pem ] || [ ! -s /certs/privkey.pem ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "TLS certificate was not created" >&2
    exit 1
  fi
  sleep 1
done
exec /docker-entrypoint.sh nginx -g 'daemon off;'
