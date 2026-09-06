# 21. A live state's entry may be rewritten in place

Date: 2026-09-06
Status: accepted

## Context

The entry page is a line of metadata in a state's `.handout`
(`docs/adr/0003-data-directory-and-entry-file.md`). Correcting a wrongly
chosen entry used to mean re-uploading the whole archive to get one field
changed, at whatever cost that upload carries. ADR 0019 asserts that "a
state directory is immutable once installed — nothing ever rewrites a file
inside `<token>/` after it lands there".

## Decision

`entry` — and only `entry` — of a live state's `.handout` may be rewritten in
place, atomically: a `.handout.<random>` file is written beside it and
renamed onto the name, a rename onto an existing file in the same directory
being atomic on POSIX, so no request ever reads a half-written `.handout`.
`root`, `kind`, `filename`, the artifact tree, the address and the password
are untouched, and no database statement runs on this path — `updated_at` is
deliberately not moved: the time a row shows means "last state uploaded",
and nothing was uploaded.

This amends ADR 0019's immutability sentence: a state's `.handout` can now
be rewritten while the state stays live. Nothing that is ever *served*
changes, though — `.handout` is never served — so the strong tag ADR 0019
builds still holds. ADR 0019's tag is over the state id plus the path
actually *served*, and for `/` that path is the resolved entry
(`src/content.js`, `resolveInState`'s `relative` and `serveContent`'s
`etagFor` call). Changing the entry therefore changes `/`'s tag on its own,
with no extra bookkeeping, and leaves every other path's tag alone — no
file's bytes change.

The reserved basename of ADR 0003 and ADR 0018 (`.handout`, `.handout-state`)
widens from the two exact names to the whole `.handout` prefix: the atomic
write's temporary sibling, `.handout.<random>`, sits inside the very
directory served as `/` when a state's `root` is `""`, and must never be
reachable during its lifetime. The price is that an artifact holding a file
whose name begins with `.handout` cannot serve it — an extension of the
exception ADR 0003 already accepted for the exact name.

There is no history and no undo: whoever mis-clicks chooses again
(`CLAUDE.md` rules out versioning of any kind). When the pointer moves
between the server-side re-check and the write — a concurrent upload landing
a new state — the change is refused (`409`) rather than applied to the new
state: ADR 0020 already decides that a new upload resolves its own entry,
and applying a choice made against a list that no longer describes what is
served would be a guess, not a correction.

Deriving the candidate list costs differently depending on who is asking.
The dashboard answers a boolean per row — "are there at least two entry
candidates?" — stopping the directory walk the moment a second candidate
turns up, since the answer never depends on which two are found first; a
PDF or a single bare HTML file never walks at all, because its `root: ""`
shape can never hold two candidates. The list itself is fetched only when a
row's panel actually opens, read fresh from the content at that moment.
Both the boolean and the fetched list, and the server-side re-check, go
through one exported membership predicate (`isEntryCandidate`), so the gate
on the menu item, the list shown and the list re-checked can never disagree.

## Consequences

An unreferenced `.handout.<random>` can survive a crash between the write
and the rename; it is never served (the widened reserved prefix) and is
removed with the rest of the state the next time `pruneStates` runs. Two
entry changes shortly after one another leave the last one standing, with no
mixture possible. The dashboard now touches the filesystem once or twice per
row on every render, which it did not before.
