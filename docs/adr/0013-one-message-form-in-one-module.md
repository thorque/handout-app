# 13. The clipboard message has one form, composed in one module

Date: 2026-09-06
Status: accepted

## Context

After publishing a protected handout, the address and the password go into a
chat or a mail together, each with a label in front, so the recipient has
everything they need without anyone typing it by hand. The same handover
happens again later, from the dashboard's row menu, for a handout that was
already published. Nothing about the wording differs between those two
moments — the recipient is being handed the same two facts either way — so
the text has exactly one settled shape: `Handout: <address>`, a line break,
`Password: <password>`, no title line, the address first, and no message at
all when there is no password, because a `Password:` line with nothing after
it reads as an error rather than as an absence.

The alternative considered was letting each screen assemble its own string —
the result page formats what it has, the dashboard row menu formats what it
has. That was rejected: two screens handing the same recipient two different
messages for what is, from the recipient's side, the exact same handover
would be a defect the moment anyone noticed the mismatch, and nothing forces
the two to be kept in step by hand.

## Decision

One function, `messageText(address, password)` in `src/message.js`, is the
only place the clipboard text is composed. It returns the two-line string
when a password is present and `null` otherwise. The two labels,
`Handout:` and `Password:`, live in `src/views/strings.js` like every other
user-visible string (docs/adr/0006). Every surface that hands a handout's
address and password over — the result page today, the dashboard's row menu
and, later, the HTTP and MCP surfaces — imports this module instead of
formatting its own text.

## Consequences

A later wording change is one edit, in one file, and every caller picks it up
without being touched. The unwelcome half: one more indirection for what is,
today, two lines of string concatenation, and a module whose only caller is a
single view until the dashboard story lands.
