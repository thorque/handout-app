#!/bin/sh
# Nothing in this repository points at the systems it was planned in.
#
# Tracker keys, tracker and wiki hostnames, page ids and design-tool URLs are
# coordinates of one installation. They mean nothing to whoever clones this,
# they outlive the tools they name, and a cross-reference that only resolves
# inside a company is worse than the sentence it replaced - so a document says
# what a thing is, never which ticket it came from.
#
# Branch names and commit messages are deliberately not covered: they carry the
# key on purpose, and they are not files in the tree.
#
# Run it directly or through `npm run check:refs`; CI runs it on every push.

set -eu

cd "$(dirname "$0")/.."

PATTERN='HANDOUT-[0-9]+|atlassian\.net|kamanninfo|[Jj]ira|[Cc]onfluence|wiki/spaces|claude\.ai/design'

# -I skips binary files (the fonts). This script names the patterns itself, so
# it is the one file excluded from its own check.
if git grep -nIE "$PATTERN" -- . ':!scripts/no-internal-references.sh'; then
	echo
	echo "A tracked file above points at an internal system, or names a tracker key."
	echo "Neither belongs in the repository: write what the thing is instead."
	exit 1
fi

echo "No internal references in tracked files."
