# 1. An address is ten characters from a 32-character alphabet

Date: 2026-09-04
Status: accepted

## Context

Every handout is reachable at a generated subdomain label. Until a password
exists (HANDOUT-8) that label is the only barrier between a stranger and the
artifact, and even afterwards it is the first one. The prototype sketched six
characters; a sketch is not a commitment. Labels are read aloud, typed by hand
and pasted into chats, so the alphabet matters as much as the length.

## Decision

A label is ten characters drawn uniformly from
`abcdefghijkmnpqrstuvwxyz23456789` — lowercase letters and digits with the
look-alikes `l`, `o`, `0` and `1` removed. That is 32^10 ≈ 1.1e15 labels, 50
bits of entropy, generated from `crypto.randomInt` per character so there is no
modulo bias. Six characters over the same alphabet (30 bits) was rejected: it is
within reach of a scripted sweep, and this story ships without a password.
A longer label was rejected because it stops being readable aloud.

## Consequences

Addresses are long enough to be worth copying rather than retyping, which is why
the result screen ships a copy handle rather than plain text. Uniqueness is still
enforced by the database column, not by the entropy: the insert retries on a
unique violation. Every label is a valid DNS label (starts with a letter or
digit, no hyphens, lowercase), so a wildcard certificate covers it.
