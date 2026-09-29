#!/bin/sh
# The development loop behind `npm run dev`: the services from compose.yaml, the
# application from source, so that a change shows without a rebuild. Run it from
# anywhere; it works from the repository root and reads the .env there.
#
# Safe to run again while the services are up: `up -d` leaves a running service
# alone. Ctrl+C ends the application only, because `exec` makes it the process
# this script has become and the containers were started detached. Stopping them
# is `npm run dev:down`.

set -eu

cd "$(dirname "$0")/.."

# PostgreSQL and Keycloak, and Keycloak's own database, which it depends on.
# --wait returns when they are healthy, and the application needs both at start
# (it runs its migrations and fetches the provider's discovery document). The
# first start takes a minute or two while Keycloak builds and imports the realm.
docker compose --env-file .env up -d --wait postgres keycloak

# Caddy on its own. --no-deps, because compose.yaml has it wait for the `app`
# service, which is the released image and not what runs here. APP_HOST in .env
# points Caddy at this machine (host.docker.internal) instead.
docker compose --env-file .env up -d --no-deps caddy

exec npm start
