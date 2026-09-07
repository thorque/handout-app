# 23. One answer for every address that shows nothing

Date: 2026-09-06
Status: accepted

## Context

A handout's address stays taken after the handout is deleted, so a viewer
holding an old link reaches an address that exists and has nothing behind
it. A made-up subdomain reaches an address that never existed. Handout knows
the difference. The question is whether a viewer may.

## Decision

**The reason first: nobody may learn whether an address ever carried a
handout.** A viewer who could tell the two cases apart would have been told
something about somebody else's material that they had no way to know
before: that this address was once handed out, and therefore that a project
existed, ended, and was taken down. An address is ten characters and can be
guessed at; an answer that says "there used to be something here" turns
guessing into reconnaissance. So the two cases are made indistinguishable,
on purpose:

- the same status, **404**, always — no 410, which would announce "this was
  deliberately removed" in the one case and nowhere else;
- the same body, byte for byte: one sentence, "This handout does not
  exist.", and **no address underneath** (the user struck that line, and it
  is also the only thing in the body that would have differed between two
  addresses);
- the same headers, because they come from **one function** that is the
  only place a viewer-side no-handout answer is composed. Two functions
  would drift, and a `Cache-Control` present on one answer and absent on the
  other is as good a tell as a different sentence.

The headers that one function sets are `Content-Type: text/html;
charset=utf-8` and `Cache-Control: no-store`. `no-store` is not decoration:
a **never-issued** address can still be issued later by `claimAddress`, so
its 404 is genuinely perishable and must not sit in any cache when the
address goes live. A deleted address's 404 is permanent and would not need
it — and gets it anyway, because it has to look identical. That is the rule
working as intended rather than an exception to it.

One string key, `error.unknownAddress`, is the whole message form, which is
what "one message form in one module" (ADR 0013) asks for applied to a
sentence rather than to the clipboard text. The page is the design's
`isWeg` screen minus its address line: `.viewer-page`, `.viewer-heading`,
nothing else. It is an information page, not an error page, and it replaces
`renderError` on the viewer side entirely; `renderError` keeps the
publisher's own refusals and the failed sign-in.

Because nothing is left to tell apart, the machinery that told the two
cases apart does not exist. `loadProtection` stays the **inner join** it
always was and returns `password` alone; `serveContent` keeps **ADR 0010's
gate order** unchanged; and there is no branch for a deleted address at
all — its container is gone, so the metadata read comes back empty and the
first exit already answers. That is not the reason for the decision, it is
its consequence: the smaller code follows from the two answers being one
answer.

Rejected: a separate sentence, a separate page and a 410 for the deleted
case. It was built first and taken back. It is exactly the disclosure this
record exists to prevent, and 410 would have carried it in the status line
even for a client that never rendered the page.

## Consequences

ADR 0010's gate is untouched, including the part that matters most: the
password gate still runs before path resolution, so a protected handout
answers 401 for a path that does not exist just as for one that does. Path
existence still does not leak, and now neither does address history.

In the ordinary case the two answers are not merely equal, they are
produced by the same code taking the same path: a deleted address and a
never-issued one both leave `serveContent` at its first exit, so there is
not even a timing difference to observe. Only a `removeContent` that failed
leaves a deleted address exiting one step later, and that path still emits
the same bytes and the same headers.

All three viewer exits in `serveContent` render this one page, and that
includes the fourth situation: a path that does not exist **inside a live
handout**. That exit already said this same sentence before this story —
what changes there is the wording and the page it is set on, not which
answer it gives. Deliberate, not a side effect.

Handout can no longer tell a viewer that an address was once in use. That
is the point, not a loss.
