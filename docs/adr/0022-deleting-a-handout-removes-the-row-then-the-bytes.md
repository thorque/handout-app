# 22. Deleting a handout removes the row, then the bytes

Date: 2026-09-06
Status: accepted

## Context

Deleting has to be effective against everyone at once, and the address has to
stay taken so an old link can never point at somebody else's material later.
Two things hold the state: a `handout` row and a `content/<address>/`
container. Something has to be the authority, and the order the two are
removed in decides what a partial failure looks like.

## Decision

The `handout` row is removed first, by a single `delete from handout where id
= $1 and owner = $2`; the foreign key's `on delete set null` leaves the
`address` row standing with `handout_id null`, which is the state "taken, but
empty". Only after that commit is `removeContent(config, address)` called,
and a failure there is logged, never thrown — the request has already
succeeded. The delete is immediate and final: no grace period, no soft-delete
column, no undo, no restore, in line with the project's no-versioning rule.
The address row surviving is not a soft delete of the handout; `Address` is a
separate entity doing its own job.

Rejected: removing the directory first, which would leave a handout that
lists in the dashboard and serves nothing if the delete then failed — a
broken row a publisher can see, instead of bytes nobody can reach.

## Consequences

A failed `removeContent` leaves a directory nobody can reach, because the
`handout` row — not the directory — is the authority for what an address
answers: `serveContent` reads it behind the address on every request (ADR
0010's own step 2) and answers the no-handout page once it is gone, whatever
is still on disk. Nothing sweeps the orphaned directory, because
`sweepAbandoned` only covers `pending/`, `staging/` and `incoming/`. That is
the accepted price of the ordering.

The ordering also settles the concurrent case: a `swapState` running against
a handout being deleted has its `update handout … returning updated_at`
affect zero rows (the DELETE holds the row lock; the UPDATE waits and then
finds the row gone), so the update refuses before it renames anything into
the container — and the container is still there at that moment, because the
disk removal only starts after the delete commits. The delete wins; the
upload unwinds cleanly and never resurrects the row or recreates the
container.
