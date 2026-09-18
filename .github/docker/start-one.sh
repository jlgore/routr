#!/bin/sh
set -eu

if [ "$START_INTERNAL_DB" = "true" ]; then
  if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    su-exec postgres initdb -D /var/lib/postgresql/data
  fi
  su-exec postgres pg_ctl start -D /var/lib/postgresql/data --options='-h 0.0.0.0'
fi

/prisma/node_modules/.bin/prisma migrate deploy --schema=/service/schema.prisma
sed -i "s|keyStorePassword:.*|keyStorePassword: $PKCS12_PASSWORD|g" config/edgeport.yaml
sed -i "s|trustStorePassword:.*|trustStorePassword: $PKCS12_PASSWORD|g" config/edgeport.yaml
su-exec fonoster ./convert-to-p12.sh "$PATH_TO_CERTS" "$PKCS12_PASSWORD"
exec su-exec fonoster node mods/one/dist/runner.js
