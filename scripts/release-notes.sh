#!/bin/sh
# The body of a GitHub release, prepended to the notes GitHub generates from
# the commits. It answers the one question a pulled image cannot: the
# migrations run when the container starts, so moving an instance to a newer
# image changes its database before it serves a request.
#
# Takes the release's tag, e.g. `sh scripts/release-notes.sh v0.1.0`. Run by
# hand against a tag that does not exist yet, it prints the first-release form.

set -eu

cd "$(dirname "$0")/.."

tag="${1:-}"
if [ -z "$tag" ]; then
	echo "usage: release-notes.sh <tag>" >&2
	exit 2
fi

version="${tag#v}"

# The previous release, or empty when this is the first one. git describe
# exits non-zero when it finds no tag, and set -e would take that for a
# failure of this script.
previous=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)

if [ -n "$previous" ]; then
	migrations=$(git diff --name-only --diff-filter=A "$previous..$tag" -- migrations/)
	since="since $previous"
else
	migrations=$(git ls-files migrations/)
	since="in this first release"
fi

cat <<EOF
    docker pull ghcr.io/thorque/handout-app:$version

Built for linux/amd64 and linux/arm64.

## What pulling this does to the database

Migrations run when the container starts, against the database
\`DATABASE_URL\` points at, and there is no down path. Take a backup before
moving an instance to this image.
EOF

if [ -n "$migrations" ]; then
	printf '\nMigrations added %s:\n\n' "$since"
	echo "$migrations" | sed 's|^migrations/|- |'
else
	printf '\nNo migration was added %s, so the schema is unchanged.\n' "$since"
fi
