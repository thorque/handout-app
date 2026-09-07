# 25. A new password replaces the old one, and the field never shows the current one

Date: 2026-09-07
Status: accepted

## Context

Address and password travel together in one message and get forwarded, so at
some point someone holds them who was not meant to. Deleting the handout is no
answer — the address is in calendar invites and minutes by then
(docs/adr/0022) — so the answer is a different password. Handout stores the
password in plain text (docs/adr/0009) and gates every request under the
address on it (docs/adr/0010), and the unlock cookie already carries a
fingerprint of the password it was minted for (`unlockFingerprint` in
`src/protection.js`).

The design prototype's own row component seeds the form's field with
`draft: pw || WORDS[random]` — the current password when there is one.

## Decision

`POST /handouts/:address/password` replaces `handout.password` and nothing
else. There is no history and no undo (`CLAUDE.md` rules out versioning of any
kind), and `updated_at` is deliberately not moved: the time a row shows means
"last state uploaded", and nothing was uploaded — the same reading
docs/adr/0021 already took for the entry change.

The field opens with a fresh suggestion from the word list on **every** open,
protected or not, fetched from the existing `GET /password-suggestion`. It
never shows the password currently in force. This departs from the prototype's
prefill on purpose: whoever opens this form is here because the old password
should stop working, so offering it back as the default is the one value that
cannot be what they want, and it would put a live secret on screen for the
length of a menu click. The story's own wording — "Feld mit Vorschlag aus der
Wortliste" — is what is followed instead. A publisher who wants to see the
current password uses "Copy password" in the same menu.

Existing viewer sessions expire with no new mechanism: `isUnlocked()` compares
the cookie's fingerprint against a sha256 prefix of the password read from the
row on every request, so replacing the password invalidates every open
session by construction. This story's duty there is the test, not a
mechanism.

Saving a password identical to the one in force is accepted as the no-op write
it is; open sessions correctly survive it, because the fingerprint is
unchanged.

An empty field removes the password and makes the handout freely reachable
again. This is not an omission the design leaves for a later story — the
prototype's own row component has the handle already: `saveRotate` hands
`s.draft` to `onRotate` unchecked, and `isProtected: !!pw` / `isOpen: !pw` /
`rotateLabel: pw ? "Neues Passwort vergeben" : "Passwort einrichten"` are all
*derived* from `pw`, so the component renders the emptied case correctly on
its own, badge and menu wording included. The design system's "password is
missing" refusal (`designsystem-field-error-and-list.excerpt.html`) belongs to
the publish screen, whose remedy is its own checkbox — this panel has no
checkbox, so an empty field is the only handle a publisher has to reach "no
password" from here, and it is the one the prototype uses. `handout.password`
is set to `null`, not `""`: a column with two representations of "no
password" is exactly the drift that bites later, and `null` is what an
unprotected handout already carries out of a first publish.

A permanent hint under the field ("Clear the field to remove the password.")
names this path — without it, the one way back from "protected" to "freely
reachable" is unlabelled and only found by trying it. This sentence is
authored by the maintainer, not taken from the prototype or the design
system, so a later reconciliation with the design system knows which
direction the alignment has to take.

## Consequences

A publisher cannot read the current password out of this form, only replace or
remove it. A mis-typed new password is not recoverable to the previous one —
it is copied out of the menu and handed over again, which is the same motion
the story is about. The route is the only writer of `handout.password` after
the first publish, so any later "reset" feature has one place to sit.

The route is also the only way back from "protected" to "freely reachable" —
there is no separate remove-password action, an empty save is the one. An open
viewer session is not merely invalidated by an empty save, the way a changed
password invalidates it (above): `serveContent`'s own gate
(`password && !isUnlocked(...)` in `src/content.js`) short-circuits on a
falsy `password`, so a request that used to need the cookie stops needing it
at all — the content simply serves, cookie or none.
