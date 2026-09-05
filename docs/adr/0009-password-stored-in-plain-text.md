# 9. A handout's password is stored in plain text

Date: 2026-09-05
Status: accepted

## Context

A handout's password has to be readable again after it was set: the result
screen offers it as a copy field, the dashboard (HANDOUT-9) offers it again
later, and reissuing one (HANDOUT-12) hands out a new one the same way. That is
the product's own promise — the publisher never has to write the password down,
because Handout keeps it. A password hash cannot answer that; a reversible
encryption could, at the price of a key that has to be configured, rotated and
kept somewhere other than next to the database it protects.

The threat this decision is about is a database dump. What that dump also
contains is the address of every handout, and the artifacts themselves sit on
the same machine, in `HANDOUT_DATA_DIR`, unencrypted, because Handout serves
them byte-for-byte. Whoever holds the dump holds the addresses, and whoever
holds the machine holds the material the password protects.

## Decision

The password is stored as it was entered, in the existing `handout.password`
column, `null` when the handout is not protected. No hash, no encryption, no
key, no second column and no new environment variable.

The comparison at the gate still goes through
`crypto.timingSafeEqual` over the SHA-256 digests of both sides, so neither the
password's length nor its prefix leaks through response timing. That costs
nothing and removes a question a reviewer would otherwise have to ask.

## Consequences

Whoever can read the database can read every password. That is the accepted
price, and it is bounded by the fact that the same access already reaches the
artifacts. It also means a password must never travel where the plain text
would outlive the moment: it is never logged, never put in a URL, never written
into a redirect, never cached, and the pages that render it are the publisher's
own authenticated screens — every one of them answers with
`Cache-Control: no-store`, because a shared cache is free to store a plain
`200 GET` with no directive at all, and cookie authentication does nothing to
stop that (only `Authorization` does).

Because it is recoverable, HANDOUT-9 and HANDOUT-12 need no mechanism of their
own — a copy field and an update. And because the unlock cookie carries a
fingerprint of the password rather than a flag (ADR 0010), replacing a password
locks existing viewers out without any of this changing.
