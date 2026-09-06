# 18. A handout serves one state behind a pointer

Date: 2026-09-06
Status: accepted

## Context

Publishing a new state onto an already-published address has to replace the
whole artifact while the address is still being served. `content/<address>/`
today *is* the artifact tree, and `promoteToContent()` is a single
`fs.rename` onto a path that must not yet exist — there is no operation that
replaces a non-empty directory atomically. Renaming the old directory away
and then renaming the new one in leaves a window in which the address 404s;
that window is exactly the "never a mixture, never a stale copy" promise
this failing.

## Decision

`content/<address>/` becomes a container rather than the artifact tree
itself:

```
content/<address>/
  .handout-state         a file holding the token of the state to serve
  <token>/               a state: the artifact exactly as it arrived, plus .handout
  <token>/.handout       { root, entry, kind, filename } — unchanged shape
```

The switch from one state to another is the atomic rename of the pointer
file: write `.handout-state.<random>` beside it, then `fs.rename` it onto
`.handout-state` — a rename onto an existing file, in the same directory, is
atomic on POSIX. A request resolves the pointer exactly once and does every
later read under the state directory it named, so one request in flight
during a swap is pinned to one complete state, never a mixture of two. When
the state a request pinned to has been removed underneath it (the swap it
raced against finished and pruned the old state before this request got to
read a file), the request resolves the pointer once more and serves the new
state whole, rather than answering 404 for a state that only disappeared
because a newer one replaced it. The state that was replaced is removed
right after the transaction that moved the pointer commits; `pruneStates`
(remove everything in the container that is neither the pointer file nor the
directory the pointer currently names) is what makes that safe under two
concurrent uploads to the same address — it re-reads the pointer at the
moment it runs, so it can never delete a state a second, later upload has
since made current.

Rejected alternatives, and why:

- **Rename the old state away, then rename the new one in.** Leaves a window
  in which the address answers 404 — the failure this decision exists to
  rule out.
- **A symlink at `content/<address>` pointing at the current state.** A
  symlink cannot be renamed over an existing directory, so no already-
  installed handout could ever be converted to this layout atomically.
- **Keep the old state for a grace period.** Bounds nothing — the disk
  ceiling would multiply by however many uploads land inside that period,
  with no natural limit.

## Consequences

Both states occupy disk between the pointer rename and the prune; that
window is what the issue's own disk note already accounts for. A crash
between the two leaves an unreferenced state directory in the container,
which the next update of that same handout's `pruneStates` cleans up. The
pointer write itself is not fsynced — a power loss can leave the previous
state pointed at, never a mixture, which is the guarantee this decision
makes and no more. `.handout-state` joins `.handout` (ADR 0003) as a second
reserved basename.
