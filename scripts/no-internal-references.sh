#!/bin/sh
# Nothing in this repository points at the systems it was planned in.
#
# Tracker keys, tracker and wiki hostnames, page ids and design-tool URLs are
# coordinates of one installation. They mean nothing to whoever clones this,
# they outlive the tools they name, and a cross-reference that only resolves
# inside a company is worse than the sentence it replaced - so a document says
# what a thing is, never which ticket it came from.
#
# The development environment's own launch config is NOT covered: it is a file
# this project keeps on purpose, so that whoever works on it can start the
# server without knowing the command. Only pointers into someone's tracker,
# wiki or design tool are the problem.
#
# Branch names and commit messages are deliberately not covered: they carry the
# key on purpose, and they are not files in the tree.
#
# Run it directly or through `npm run check:refs`; CI runs it on every push.

set -eu

cd "$(dirname "$0")/.."

PATTERN='HANDOUT-[0-9]+|atlassian\.net|kamanninfo|[Jj]ira|[Cc]onfluence|wiki/spaces|claude\.ai/design'

# -I skips binary files (the fonts and the sample archives). This script names
# the patterns itself, so it is the one file excluded from its own check.
#
# --untracked, because tracked-only is one commit too late: a brand-new file is
# untracked until the moment it is staged, so the check that is supposed to
# stop it from entering the repository is the one check that cannot see it. It
# happened - a new decision record carrying tracker keys passed this script
# twice, and only surfaced when it was staged. Ignored files stay out either
# way (that is what --untracked means here), so this looks at exactly the set
# that is on its way into a commit.
if git grep --untracked -nIE "$PATTERN" -- . ':!scripts/no-internal-references.sh'; then
	echo
	echo "A file above points at an internal system, or names a tracker key."
	echo "Neither belongs in the repository: write what the thing is instead."
	exit 1
fi

echo "No internal references in the files headed for a commit."
