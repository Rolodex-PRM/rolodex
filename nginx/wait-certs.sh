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
if [ "${WEB_TLS_PORT:-443}" = "443" ]; then
  export HTTPS_PORT_SUFFIX=
else
  export HTTPS_PORT_SUFFIX=":${WEB_TLS_PORT}"
fi
exec /docker-entrypoint.sh nginx -g 'daemon off;'
