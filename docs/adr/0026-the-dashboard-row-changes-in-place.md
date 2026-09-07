# 26. The dashboard row changes in place, so its variable parts are always rendered

Date: 2026-09-07
Status: accepted

## Context

A password change alters four things in the row that carries it: the badge
("Password" / "Freely reachable"), the presence of the two copy items in the
`⋯` menu, what those items put on the clipboard, and the wording of the item
that opened the form ("Set a password" / "Issue a new password"). The row
upload and the entry change (docs/adr/0021) both already refresh the row
without a reload, and the publisher stays where they are, with no jump to the
top and no other row's menu closed. The clipboard text has exactly one author,
`src/message.js` (docs/adr/0013).

## Decision

The row's variable parts are all rendered by the server on every row and the
ones that do not apply carry the `hidden` attribute: both badges, and both
copy items. After a successful save the client toggles `hidden` and fills the
two `data-copy` attributes from the route's own JSON answer, which carries the
new `password` and the finished `message` text. The client never composes the
message text — `src/message.js` stays its only author — and it holds no
interface literal: the item that swaps its wording reads both labels from
`data-label-*` attributes the view wrote (docs/adr/0006).

The alternative — building the items in the browser from a `<template>` —
was rejected: the copy handles and the menu's auto-close timer are bound once
at `DOMContentLoaded`, so freshly created items would need a re-binding path
that nothing else in this codebase has.

## Consequences

The dashboard's HTML carries a few hundred bytes per row for states the row is
not currently in. A `hidden` element is out of the accessibility tree and off
the screen, so the design's rule — without a password the item "Passwort
kopieren" drops out and the badge shows "Frei erreichbar" — still holds
exactly. Tests about the menu and the badge count what is *visible* per row
rather than how often a word occurs in the page, which is the stronger
question anyway. A later story that mutates a row follows this rule instead of
inventing a re-render.
