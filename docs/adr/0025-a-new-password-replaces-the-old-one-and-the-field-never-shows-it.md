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
unchanged. Removing a password — protected back to free — is not offered:
neither the story nor the design has a handle for it, and the menu item only
ever sets one.

## Consequences

A publisher cannot read the current password out of this form, only replace it.
A mis-typed new password is not recoverable to the previous one — it is copied
out of the menu and handed over again, which is the same motion the story is
about. The route is the only writer of `handout.password` after the first
publish, so any later "reset" feature has one place to sit.
