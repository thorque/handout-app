# 11. Wrong passwords get a growing delay, held in process memory

Date: 2026-09-05
Status: accepted

## Context

A handout's address is fifty bits (ADR 0001) and its password is a suggestion
from a word list, so the pair is not guessable by hand — but the password page
is a plain form with no cost per attempt, and a script that already has the
address can work through candidates as fast as the network allows. The people
being protected against a mistyped password and the script are the same
endpoint, so whatever is done has to be invisible to one and ruinous to the
other.

A lockout is not available: it would let anyone who knows an address deny the
material to its actual recipients, and Handout has no way to tell them apart —
there are no viewer accounts.

## Decision

Failed attempts are counted per address and client, and from the **third**
consecutive failure the answer is delayed before it is sent:
`min(1000 · 2^(n−3), 10000)` milliseconds — 0, 0, 1 s, 2 s, 4 s, 8 s, 10 s,
10 s, … A correct password is answered immediately and drops the counter. There
is no lockout, no message about the delay, and no second error sentence: the
page a viewer sees after their third mistype is the same page, a moment later.

The counter lives in a `Map` in the process, not in the database: the technical
brief prescribes one application process with no cache and no replication, the
domain model has two entities and no room for a third, and a row written per
failed attempt would make an attacker's traffic durable.

Three properties keep that Map from becoming a liability of its own: an entry
untouched for 15 minutes is forgotten, at 10 000 entries the least recently
used one is dropped, and the whole thing is empty after a restart. The key is
the address plus `request.ip`, which behind Caddy is the client's own address.

The escalation is a pure function (`delayFor`) and the wait is an injected
`sleep`, so the schedule is unit-tested exactly and the route-level tests
record the delays that were asked for instead of waiting them out.

## Consequences

Someone who mistypes twice notices nothing. A script is down to six attempts a
minute per address, which at the entropy of a generated suggestion is
thousands of years — and it never locks the legitimate viewer out.

The price is named honestly: the counter is per process, so a restart forgets
it, and `request.ip` comes from `X-Forwarded-For` behind the proxy, which is
only as trustworthy as the proxy (ADR 0004 accepts that already, and Caddy
ships as part of the product). Both mean the throttle is a speed bump and not
an authentication control. There is no environment variable for any of it:
configuration in this project has no defaults, and a knob nobody has to set is
a knob everybody would have to set.
