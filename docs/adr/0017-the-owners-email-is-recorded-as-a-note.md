# 17. The owner is the provider's identifier; the owner's email is kept beside it as a note

Date: 2026-09-06
Status: accepted

## Context

`owner` holds the identifier the identity provider hands over — the `sub`
claim — and it is what decides whether a handout appears in someone's list.
The question came up whether the email address would be the better choice,
since it looks unique and looks the same at every provider.

It is neither, for the purpose of deciding ownership:

- An email address changes. A name change or a move to a new company domain
  gives the same person a new address, and with the address as the owner every
  handout they published is gone.
- An email address is reassigned. When someone leaves and their address is
  later given to a new colleague, that colleague inherits every handout the
  first person published, passwords included. That is not an inconvenience, it
  is someone seeing protected content that was never handed to them.
- An email address is optional. OpenID Connect does not oblige a provider to
  release `email`; it depends on the scope and on consent, and
  `email_verified` may be false. The specification names `iss` together with
  `sub` as the only claims a client may rely on as a stable identifier, and
  says the email is not one.

So `sub` stays. What it does not answer is the case that prompted the
question: if the operator moves the installation to a different identity
provider, every `sub` changes at once. Handout keeps no user table (there is no
`User` entity — the domain is `Handout` and `Address`), so nothing is left to
map the old identifiers onto the new ones, and every handout is orphaned. The
same shape of failure appeared in the workbench when the realm fixture did not
pin its users' ids, which is fixed there by pinning them; a provider migration
is the version of it that no fixture can prevent.

## Decision

`handout.owner_email` records the email of whoever published the handout, at
the moment they published it. It is a note and nothing else:

- Nothing reads it to decide access. Every query that answers "whose is this"
  matches on `owner`, and that does not change.
- It is nullable. Rows written before this column existed have none, and a
  provider that releases no email leaves it null.
- It is not kept in step afterwards. Someone whose address changes keeps the
  old one on their existing rows; that is what a note of "who published this,
  back then" means, and refreshing it would need the user table this product
  deliberately does not have.

Its one purpose is a migration a human runs deliberately: after a provider
change, the operator maps the new identifiers onto the old rows themselves,
with the email as the human-readable link.

## Consequences

An operator can move providers without the handouts becoming unreachable, at
the price of one deliberate step per person rather than an automatic one.

Handout now stores an email address, which it did not before. It is written
once, never displayed to a viewer, and never sent anywhere — but it is personal
data sitting in a row next to a plain-text password (docs/adr/0009), and
whoever operates an installation should know it is there.

The column can mislead if it is ever read as an identity. It is not one: the
comment on the migration, the comment at the insert and this record all say so,
and a future story that wants to show "who published this" should think about
whether the note is still true rather than assuming it.
