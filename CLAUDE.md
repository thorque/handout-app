# Handout

Handout turns a finished artifact into a durable, optionally password protected
address on your own infrastructure. Upload a file, hand out the link, and
everyone involved sees the current state from then on. Self hosted, Apache 2.0.

## Stack

- Node application, server rendered HTML. **No bundler and no build step.**
- PostgreSQL for handouts, addresses and passwords.
- Caddy in front, part of the product: one wildcard vhost, holds the wildcard
  certificate through the DNS-01 challenge, passes host and scheme through.
- OIDC against a configured identity provider. Handout manages no users.
- Brought by the app itself, not run as services: web framework, zip reader,
  OIDC client, PostgreSQL driver, migration tool.

## Conventions

These hold for every task.

- **Host resolution.** Every request is decided on the first label of the Host
  header: if it resolves to an `Address`, serve content, otherwise serve the
  publisher interface. No hostname is ever configured.
- **Forwarded headers.** Behind Caddy, read `X-Forwarded-Proto` and
  `X-Forwarded-Host` when building absolute URLs, or the addresses handed out and
  the OIDC redirect URI come out wrong.
- **Password cookie.** `httpOnly`, scoped to the handout's address, `Secure` from
  configuration because the development tunnel runs without TLS.
- **Configuration is environment variables without defaults.** A missing value
  aborts the start and names itself. Never fall back to a development value.
- **Protection covers all content**, not only the entry page: images, sub pages
  and attachments are unreachable without the password.
- **Atomic replacement.** An update writes the new content beside the old, then
  switches, then discards the old one. No request ever sees a mixture.
- **Migrations, not an init script.** They run on start and arrive with the first
  story that needs a table.
- **Everything in the repository is English**: code, comments, docs, commit
  messages.

## Domain vocabulary

Two entities. Use these words, do not invent synonyms.

- **Handout** - a published artifact. `title`, `owner`, `password` (optional),
  `createdAt`, `updatedAt`. `owner` is the identifier the identity provider hands
  over. There is no `User` entity.
- **Address** - the generated, unique address a handout is reachable at.
  `value`, `createdAt`. Exactly one per handout, and it **survives the handout's
  deletion**, so an old link can never point at new material.

No states, no enumerations, no lifecycle. A handout exists or it is gone.

## Where decisions go

`docs/adr/`, numbered, one file per decision. Every decision taken while
building is recorded there, not in the discovery. A recorded decision is not
reopened; it is superseded by a new ADR that says so.

## Running things

- `npm start` runs the application; migrations run on start. `npm test` needs a
  PostgreSQL it may create and drop databases on.
- A server listens on `0.0.0.0`, never `127.0.0.1`: it has to be reachable from
  outside its own container, and the addresses Handout hands out are derived
  from the request, so a loopback binding makes every one of them wrong.
- Acceptance for a piece of work: its acceptance criteria are met, tests and
  build green.
- How a server is started and kept alive is a property of the environment you
  are in, not of this project. Whatever briefing that environment gives you
  decides it; this file does not.


## Interface

Server rendered. JavaScript only where HTML cannot do the job: dropping a file,
upload progress, copy to clipboard. Paper as the ground, ink as the text, one
accent, red for deletion and for errors. No shadows, hairline rules, nearly square
corners, no house colour, no imagery. Light and dark through
`prefers-color-scheme` plus a switch (light, dark, system; system by default,
stored per device). Contrast AA in both. The font ships with the app, two
weights, self hosted and never loaded from a font service.

## What this file does not cover

Internal coordinates for this project exist outside the repository and are not
named here.

How contributions from outside are handled is not decided yet. It is a product
decision and nothing in the discovery answers it, so this file stays silent on
it until it is settled.

## Out of scope

The fence saves more time than any instruction.

- Nothing dynamic in the uploaded artifact. What arrives is finished.
- **No versioning of any kind.** No history, no version numbers, no restoring an
  earlier state. Where that is needed it belongs in the tool the artifact comes
  from.
- **Handout never touches the artifact**: no bar, no branding, no injected
  script. The viewer sees the content and nothing else.
- No assembling artifacts: no zipping, no inlining, no guessing.
- No command line application. Agents use the MCP endpoint, people use the
  browser upload, scripts use the HTTP interface.
- No operation as a service: no registration, no tenants, no hardening against
  malicious uploaders. Whoever may upload is trusted.
- No viewer accounts, roles or groups. Whoever has the address and the password
  sees the content.
- No file storage and no download service. Everything uploaded exists to be
  displayed.
- No reach measurement and no tracking of viewers.
