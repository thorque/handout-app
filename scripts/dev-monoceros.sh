#!/bin/sh
# The development loop behind `npm run dev:monoceros`, for a Monoceros workbench:
# the workbench already runs PostgreSQL, Keycloak and Caddy, so this only puts
# the workbench's values in .env, installs, and starts the application through
# its launch config (.monoceros/launch.json). Run it inside the workbench, from
# anywhere; it works from the repository root.
#
# Safe to run again: an existing .env is left alone, so values somebody adjusted
# survive.

set -eu

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo ".env exists, left as it is"
else
  cp .env.monoceros.example .env
  echo ".env created from .env.monoceros.example"
fi

npm install

# The app is the directory's name under projects/, so a clone in a differently
# named folder works too.
exec monoceros-ctl start "$(basename "$PWD")"
