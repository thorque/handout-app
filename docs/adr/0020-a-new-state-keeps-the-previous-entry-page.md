# 20. A new state keeps the previous entry page

Date: 2026-09-06
Status: accepted

## Context

ADR 0012 asks the publisher which HTML file is the entry page when a zip is
ambiguous (several HTML members, no `index.html`). That question is the
right one on a first publish, where nothing is known yet. On an update it
can turn into rework: a publisher who re-exports the same site every day and
uploads the result again would otherwise be asked to choose the entry page
on every single upload, even though it is the same file every time. The
journey behind this story promises that a routine re-upload runs "without a
decision and without rework".

## Decision

On an update, the entry is re-resolved from the new archive by ADR 0012's
existing rules first, exactly as on a first publish. Only when that
resolution comes out ambiguous does the previous state's `entry` get
consulted: if it is a member of the new archive's candidate list, it is
chosen silently and the update completes with no question asked. Only when
the previous entry is not among the new candidates — the file was renamed or
removed — is the publisher taken to the existing entry-choice screen.

## Consequences

The entry page of an already-published handout follows the new archive
whenever that archive resolves on its own — a new zip carrying an
`index.html` makes it the entry, exactly as it would on a first publish.
What this decision rules out is the other case: an ambiguous archive never
turns into a question for a file that already is the entry. Deliberately
changing the entry page of a published handout without re-uploading is its
own, later capability. A
publisher who renames their entry file is asked once, at the point the
rename actually happens, and not on any later, unrelated upload.
