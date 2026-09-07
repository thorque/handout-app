# 24. The delete confirmation is a native modal dialog

Date: 2026-09-06
Status: accepted

## Context

The confirmation is the first modal in the product. The design draws it as an
overlay `<div>` carrying `role="dialog" aria-modal="true"` over a scrim
`<div>` — which is what a prototype with no platform underneath it can draw.
The story's own edge case is "operate the dialog with the keyboard and cancel
it", and the project's rule is JavaScript only where HTML cannot do the job.

## Decision

A native `<dialog>` opened with `showModal()`. It brings the focus trap, the
inertness of the page behind it and Escape-to-cancel from the platform, and
its own `::backdrop` replaces the prototype's scrim `<div>` — painted
`var(--scrim)`, the same token. `role`/`aria-modal` are implicit and are not
written out. One dialog per page, not one per row: its sentence is
server-rendered from `strings["dash.deleteSentence"]` with the two
placeholders replaced by empty `<span>`s that the script fills with
`textContent` when it opens, so the word order stays in the string module,
nothing is templated in the client and nothing has to be escaped there.
Confirming is a real `<form method="post">` answered with `303` back to the
dashboard — the count sentence and the empty state are server-rendered and
re-deriving them in the client for one action would duplicate that logic.
`autofocus` sits on **Cancel**: a modal that opens with the destructive
control focused turns a habitual Enter into a deletion, and the design
system's picture of a focused Löschen button demonstrates the focus ring on a
danger surface, it is not a statement about which control opens focused.

Rejected: hand-written focus trapping over the design's overlay `<div>`,
which is the job the platform already does; and `formmethod="dialog"` on the
cancel button, which would close it without script but is asymmetric with an
opening that is script-only anyway.

## Consequences

Without JavaScript there is no delete — and that is consistent, not a
regression: the whole `⋯` menu is rendered `hidden` and revealed by
`initRowMenu()` because every item in it is script-only, so there is no
no-JavaScript path into the dialog to serve HTML into. Cross-site protection
is the session cookie's `sameSite: "lax"`, which does not travel on a
cross-site POST — the same protection `POST /handouts` already has, no new
mechanism. `::backdrop` resolves `var(--scrim)` through its inheritance from
its originating element; say so in a one-line CSS comment.
