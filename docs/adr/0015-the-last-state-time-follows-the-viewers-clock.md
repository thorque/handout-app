# 15. The last-state time follows the viewer's clock

Date: 2026-09-06
Status: accepted

## Context

The row shows when a handout last got a new state. The server has no
business guessing the reader's zone, and a bare time without a zone is a
wrong time for anyone travelling. `CLAUDE.md` allows JavaScript only where
HTML cannot do the job, and HTML cannot do this one.

## Decision

The server renders `<time datetime="<ISO 8601 UTC>">` with a text that names
its zone ("2 September, 19:44 UTC"); the client script rewrites it to the
device's zone ("2 September, 21:44") on load. The format's locale stays
pinned to en-GB (the interface language, docs/adr/0006); only the zone
follows the device.

Rejected: sending the zone to the server (a cookie or a header for one line
of text) and rendering server-local time (wrong for everyone else).

## Consequences

A named exception to the JavaScript rule; without JavaScript the reader
keeps a correct time in a zone that is named, never a bare one.
