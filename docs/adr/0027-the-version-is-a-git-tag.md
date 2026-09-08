# 27. The software's version is a git tag, semantic and below 1.0

Date: 2026-09-08
Status: accepted

## Context

Handout is distributed as a container image now, so whoever pulls one has to be
able to say which Handout they are running, and whoever upgrades has to be able
to see what changed. Nothing in the repository carried a version until now:
`package.json` is `private: true`, has no `version` field and is never published
to a package registry.

This does not contradict "no versioning of any kind" in `CLAUDE.md`. That rule
is about handouts — the published artifacts have no history and no version
numbers, and where that is needed it belongs in the tool the artifact comes
from. The software that serves them is a different thing and does have
versions.

## Decision

Versions are semantic and start at `0.1.0`. The line stays in `0.x` while the
feature set is still growing; `1.0.0` is held for the moment the maintainer
wants to promise stability, and until then a breaking change is a minor bump.

The **annotated git tag `v<major>.<minor>.<patch>` is the only place a version
is written**, and pushing it is what triggers a release. `package.json` gains no
`version` field: two places holding the same number drift, and npm's field means
nothing for a package that is private and never published. On a pulled image the
version is readable from the tag it was pulled by and from the OCI label
`org.opencontainers.image.version`, which the workflow derives from the git tag.

Image tags follow from that:

- a release tag publishes the exact version (`0.1.0`) and moves `latest`;
- a commit on `main` publishes `main` and `sha-<short>` and never touches
  `latest`.

So `latest` follows the newest release and can never land on an untagged state,
while `main` exists for the time before the first release and for trying
something out. The alternative — `latest` following `main` — was rejected: it is
the tag people pull without thinking, and it has to mean "the newest thing that
was released", not "the newest thing that was committed".

A release's notes name the migrations the release brings, because the
application runs its migrations at start: pulling a newer image changes the
database before the first request is served.

## Consequences

A release cannot be made from a workbench. It needs a tag pushed to the remote,
and only CI builds the image — which is also the only place that can build it,
since the development container reaches no Docker daemon.

Tags are append-only by convention. Moving or reusing one would move `latest`
backwards, and nothing enforces that it does not.

The running application does not report its own version: there is no endpoint
and no line in a log that names it. An operator reads the tag they pulled or the
label on the image. Should that turn out not to be enough, exposing it is its
own story and its own decision.
