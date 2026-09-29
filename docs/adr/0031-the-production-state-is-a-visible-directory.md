# 31. The production state is a visible directory, and the containers have fixed names

Date: 2026-09-29

Status: accepted

## Context

The first real deployment of `deploy/` (`docs/adr/0030`) turned up two things.

The guide told the operator to back up four named Docker volumes. Their
contents sat under `/var/lib/docker/volumes/deploy_*/_data`, a path Docker
treats as an internal detail. A guide that asks for a backup while hiding the
files contradicts itself.

The containers were called `deploy-app-1` and so on, generated from the
directory name. On a machine that runs more than one thing that says nothing.

## Decision

`deploy/compose.yaml` keeps all state in bind mounts under one directory,
`HANDOUT_STATE_DIR` (documented default `/srv/handout`): `artifacts`,
`postgres`, `keycloak-db` and `caddy`. There are no named volumes. The project
is named `handout` and every service has a fixed `container_name`
(`handout-app`, `handout-caddy`, `handout-db`, `handout-keycloak`,
`handout-keycloak-db`, `handout-data-owner`).

The local `compose.yaml` at the repository root deliberately stays with named
volumes and generated names. There, being throwaway is the property that
counts. This is the same difference between the two examples that ADR 0030
already draws.

## Consequences

A `tar` or `rsync` of one directory is the whole backup, and `docker ps` is
readable. `test/deployment.test.js` fails when the guide stops naming one of the
paths.

The operator gives up the portability of named volumes and owns the path and its
permissions. `container_name` rules out two instances on one host, which is
right for a deployment that serves one domain. Nothing had to be migrated: the
change landed the day the first instance went up, and the guide describes one
way of installing rather than a way and a transition away from an older one.
