# 6. The interface is English, and every user-visible string lives in one module

Date: 2026-09-04
Status: accepted

## Context

Handout is an Apache 2.0 project that other people are meant to run. `CLAUDE.md`
mandates English for code, comments, docs and commit messages and says nothing
about the interface, so the interface language was genuinely open. The discovery
argues for German: the personas are German and the prototype's wording is German.
But what the prototype and the design brief are worth is the tone, not the
words — "Delete handout", not "Are you sure you want to permanently remove this
handout?" — and the tone survives translation intact.

The two audiences also fall apart, and only one of them argues for more than one
language. The publisher interface is the operator's own team, who already meet an
English README, English environment variables and English logs. The viewer pages
are the operator's clients, who did not choose Handout and get no say in what it
speaks. This story has no viewer page at all: the password prompt is HANDOUT-8 and
the notice for a taken address is HANDOUT-11.

## Decision

Two halves.

The interface language is English. The design brief's tone binds every string
unchanged: sober, no exclamation marks, no "we", no success message with a check
mark, the domain words `Handout` and `Address` and no English near-synonym
("upload", "link", "share", "publication") standing in for either.

No user-visible string sits inline in a template. They all live in one flat
module, `src/views/strings.js`, with `{placeholder}` slots where a value is
interpolated — so the upload ceiling still comes from configuration and is never
baked into a template. The views and the routes read from it, the tests assert
against it, and the client JavaScript takes the few strings it needs from `data-`
attributes rather than keeping its own copies.

No i18n machinery: no `Accept-Language` negotiation, no second catalog, no
switch. There is no story for it and no acceptance criterion, and a second
catalog would have to be carried by every story from here on.

## What this does not decide

Whether Handout ever speaks more than one language, and in particular what the
viewer pages speak — their readers did not choose the product. That question
returns with HANDOUT-8, where the first viewer page appears, and it can be
answered then without touching a template: the module is the seam.

The German wording in the prototype and the design brief is kept as the tone
reference and would become the German catalog if that decision is ever taken, so
nothing is lost by starting in English.

## Consequences

Collecting the strings costs one indirection on every label, and that is the thing
that makes a later language a mechanical change instead of a rewrite. It also puts
the tone in one reviewable file rather than spread over five views, which is the
part the design brief actually cares about. The cost is a discipline that has to
hold: a string written straight into a template still renders, so reviews look for
it, and the tests assert against the module rather than against literals so a
changed string never needs the same edit twice.
