# 33. The databases and the certificate store are named volumes; only the artifacts are a directory

Date: 2026-09-29

Status: accepted

Supersedes ADR 0031 in part. That record's status line says so and is otherwise
left as it was written. What is reversed: that all four state directories are
bind mounts under `HANDOUT_STATE_DIR`, and with it "a `tar` or `rsync` of one
directory is the whole backup". What holds: the project is named `handout`, every
service has a fixed `container_name`, and the published artifacts are a visible
directory. It also amends ADR 0032 in the same way: there it says that there are
no named volumes, that everything is a bind mount under `./state`, and that
deleting `state/` starts the trial empty. From ADR 0028 nothing changes; its
sentence that PostgreSQL and the data directory keep volumes is true again for
PostgreSQL.

## Context

**This is a defect, found by running it, and not a change of taste.** The
maintainer ran `npm run dev` on macOS, and Keycloak's database restarted forever:

```
fixing permissions on existing directory /var/lib/postgresql/18/docker ... ok
FATAL:  data directory "/var/lib/postgresql/18/docker" has wrong ownership
HINT:  The server must be started by the user that owns the data directory.
```

Docker Desktop maps the ownership of a bind mount to the host user, so the
directory is not owned by uid 999 inside the container, and `initdb` refuses to
use it. Every macOS and Windows user would hit this, in the development loop and
in the local trial alike. ADR 0031 and ADR 0032 chose bind mounts for all four
state directories and were never run on such a machine; Linux, where the
container's root can hand a directory to any uid, hid it.

The same choice had a second flaw that was not observed but is certain: the guide
promised that one `tar` or `rsync` of the state directory is the whole backup. A
file copy of a running PostgreSQL data directory is not a valid backup on any
platform.

## Decision

| What | How |
| --- | --- |
| the published artifacts | a bind mount at `HANDOUT_ARTIFACTS_DIR`, as before |
| the application's database | the named volume `postgres-data` |
| Keycloak's database | the named volume `keycloak-db-data` |
| Caddy's certificate store | the named volume `caddy-data` |

The artifacts are plain files that an operator wants to see and copy, and the
`data-owner` service already makes the directory writable for the application, so
the ownership mapping does no harm there. The other three are machine data
nobody inspects by hand, and two of them are exactly what refuses a mapped
owner.

**The variable is renamed from `HANDOUT_STATE_DIR` to `HANDOUT_ARTIFACTS_DIR`.**
It now points at one directory, not at a base with four subdirectories, and a
name that promises all state while delivering one part of it invites the exact
mistake ADR 0031 made in the guide: to believe that copying it saves everything.
A compose started with an old `.env` stops and names the missing variable, so the
rename cannot be missed silently. The local default is `./artifacts`, and
`.gitignore` ignores `/artifacts/` instead of `state/`.

A backup is now two acts. The artifacts directory is copied; each database is
dumped with `pg_dump` from the running container, and restored with `pg_restore`
into a database that nothing has written to yet. Caddy's volume can be archived
with a throwaway container. `docs/deployment.md` gives the commands for both
directions, since a backup that was never restored is not one.

## Consequences

Docker owns the databases, so PostgreSQL starts on every platform. The price is
what ADR 0031 set out to remove: the databases' files are under Docker's own
path and an operator cannot read them; they are reached through `pg_dump` and
`docker volume`. The volume names carry the project name (`handout_postgres-data`
and so on).

The volumes are dropped by `docker compose down -v`, `docker volume rm` and
`docker volume prune` run while the stack is stopped, and by nothing else.
Discarding Caddy's store has a cost that must not be lost: every certificate is
requested again at once, and past roughly fifty active handouts that exceeds Let's
Encrypt's weekly allowance and some addresses stay unreachable for days. The
guide says so where it names the volume.

Starting the local trial or the development loop empty is now `down -v`, plus
deleting `artifacts/` for the trial. Repairing Keycloak's missing administrator
is removing the one volume `handout_keycloak-db-data` after `down`, never
`down -v`, which takes the application's database with it.

**A machine that ran the old compose has a `state/` directory beside it.** It is
no longer used and nothing reads it; delete it (`sudo` on Linux). Its `artifacts`
subdirectory is what to move to the new `HANDOUT_ARTIFACTS_DIR`, and its
`postgres` and `keycloak-db` directories are not migrated: they may be the very
directories that PostgreSQL refused. An instance that has real handouts in
`state/postgres` dumps them before the change, from the old compose, and restores
them after. Nothing was in production yet when this was decided.

This could not be verified against a Docker daemon where it was written. What is
verified is the file: `test/deployment.test.js` and `test/compose.test.js` pin the
bind mount, the three volumes and the guide's commands. That PostgreSQL now
initialises on macOS is the maintainer's to confirm, and the record says so
rather than claiming it.
