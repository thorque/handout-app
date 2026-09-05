# 12. A zip with several HTML files and no index.html asks which one is the entry page

Date: 2026-09-05
Status: accepted

## Context

ADR 0003 resolves a zip's entry page by three rules — an `index.html` at the
root, one in a single wrapper folder, or exactly one HTML member — and refuses
everything else. That covers the accidental case, but not the normal one: a
real export tool (several HTML pages beside a shared script and an uploads
folder, none of them named `index.html`) is not a malformed upload, it is the
shape most export tools actually produce. Guessing among several HTML files is
the wrong answer — a guessed entry is silently wrong, and on an artifact that
arrives "finished" nobody notices until a viewer does.

Verified against ADR 0003's own rule 2 while planning: a multi-page export
whose only *folder* happens to hold an `index.html`, while its real pages sit
at the root, resolved to that folder silently — the folder is not a wrapper
around the whole artifact, and the real pages became unreachable.

## Decision

`resolveZipEntry` returns a discriminated result of four branches, checked in
this order:

1. `index.html` at the archive root → resolved, root `""`.
2. Exactly one top-level directory, that directory holds `index.html`, **and
   no HTML member sits outside it** → resolved, root is that directory. The
   italicised clause amends ADR 0003's rule 2: without it, an export whose
   pages sit at the root and whose only folder happens to hold an
   `index.html` (an `uploads/index.html`, say) would resolve to that folder
   and hide the real pages — the defect above.
3. Exactly one HTML member in the whole archive → resolved, as before.
4. Two or more HTML members → **ambiguous**. The single top-level directory
   still becomes `root` when one exists and every HTML member lives under it
   — a wrapper folder is recognised independently of the choice, which only
   ever sets `entry`, never `root` — otherwise `root` is `""`, so a candidate
   is never silently dropped for living outside a folder that is not really a
   wrapper.
5. No HTML member at all → **none**. This amends ADR 0003's rule 4: a zip is
   now refused only when it holds no HTML member at all, not merely because
   the entry can't be derived among several.

The **candidate list** shown for an ambiguous zip, and re-derived server-side
for the confirm, comes from one function (`entryCandidatesFrom`): archive noise
removed by the same helper the resolution itself uses, HTML members only,
relative to `root`, sorted root-first then folders alphabetically with a fixed
`Intl.Collator("en", { numeric: true })` — a bare `localeCompare` does not
promise the same order on every machine. There is no second filter and no
stored copy of this list; the render and the re-check both call it fresh.
**Nothing is ever preselected** — a preselected candidate is a guess wearing a
radio button, exactly what this story exists to stop.

**The staged upload.** An ambiguous zip is extracted as usual and its
`.handout` is written with `entry: null`; the staging directory is kept, not
discarded — the caller (the publisher route) owns it from here. What the
direct publish would have written to the database — title, protect flag,
password, owner, filename — is instead written to
`pending/<token>.json`, a fourth child of the data directory alongside
`content/`, `staging/` and `incoming/` (amending ADR 0003's three): the domain
has exactly two entities and no room for a third. The chosen entry lands in
the same `.handout` file the direct path already writes, in the same `entry`
field — no new format. The pending record holds the password in plain text on
disk for at most an hour; ADR 0009 already accepts a plain-text password in
the database, and this one never reaches `content/`.

An upload left on the entry-choice screen is swept after one hour: on every
publish attempt and once on server start, anything under `pending/`,
`staging/` or `incoming/` older than `ABANDONED_AFTER_MS` is removed.
Sweeping `incoming/` too costs nothing and catches a stream that broke off
mid-transfer. The hour is a constant in the code, not an environment
variable — CLAUDE.md requires every configuration value to be one without a
default, and this is too small to be worth one more thing that can be missing
at start, the same reasoning as the address length (ADR 0001). "Abbrechen"
on the entry-choice screen discards the upload immediately rather than
waiting out the hour.

**Two requests, one screen, one URL.** `POST /handouts` stays the single
upload route. When the zip is ambiguous it answers a `location` to
`GET /handouts/entry/<token>`, which renders the selection screen; that
screen's own form posts to the same URL, which either publishes (the entry
re-checked against `entryCandidatesFrom` again — exact membership, not merely
"resolves inside the root", refuses a real member that is not HTML the same
way it refuses a path outside the archive) or discards on cancel. Both the
JavaScript client and a form with no JavaScript follow the same location to
the same server-rendered screen: `handout.js` already follows any 2xx response
that carries a `location`, so the ambiguous branch needed no client change at
all.

**A zip with no HTML file at all** answers the same way — a `location` to
the stateless `GET /handouts/rejected` — rather than a 4xx. This is the
consequence worth naming explicitly: the maintainer's answer that this case
gets its own screen, not a re-framed drop area, means the refusal is carried
by the screen and its sentence, not by the response status, and it keeps the
JSON and the no-JS path on one answer shape instead of two.

## Consequences

`resolveZipEntry` returns `{status, ...}` instead of throwing on everything it
does not resolve; only `status: "none"` still throws (`NoHtmlError`, which
replaces `NoEntryError`). Publishing a new state onto an existing address, and
taking the entry as a parameter in an agent call, reuse this shape: the
four-branch result, the one candidate function, and the
pending-record-plus-staging-directory pattern for anything that has to wait on
a choice before it can be committed.

The price named honestly: the JSON client now gets a `location` to follow for
a case that used to be a 4xx with an `error` string (the no-HTML zip), so an
API caller that inspected the status code alone for that case has to inspect
the location instead — accepted because it keeps one answer shape rather than
growing a second one for a single case, and no story yet built against the old
4xx.
