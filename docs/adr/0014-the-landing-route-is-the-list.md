# 14. The landing route is the list

Date: 2026-09-06
Status: accepted

## Context

Signing in used to land on the publish form at `/`; publishing is a minority
of the visits once a handout exists, and the list is the screen every later
journey (update, delete, reissue) starts from.

## Decision

`/` serves the dashboard, the publish form moves to `/handouts/new`,
`/handouts/<address>` stays the result page, and the result page leads back
with two buttons.

Rejected: keeping the form on `/` and putting the list at `/handouts`, which
would make the screen the publisher needs most often the one behind a link.

## Consequences

Every existing pointer at `/` as the form has to move with it (the
entry-choice cancel, the rejected screen, the tests), and a bookmark on `/`
now opens a different screen than before.
