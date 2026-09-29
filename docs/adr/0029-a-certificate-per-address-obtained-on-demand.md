# 29. A certificate per address, obtained on demand

Date: 2026-09-28

Status: accepted

## Context

A public instance serves the publisher interface at one name and every handout
at `<address>.<that name>`. Over HTTPS each of those hostnames needs a
certificate, and the addresses are generated at runtime, so no operator can
list them in advance.

Three ways to have a certificate for every address were looked at, and one that
needs none of what they need.

## Decision

Caddy obtains one ordinary certificate per known name at start, and one per
handout address at the first handshake, through on-demand TLS. What gates the
second kind is an ask endpoint in the application,
`GET /.handout/tls-check?domain=<the full hostname>`, which answers on the first
label: `204` when it is an address that exists, `404` otherwise. The publisher
origin and the identity provider are named site blocks and never go through that
path; only the block whose address is the hostname pattern `*.<domain>` does.

Nothing here obtains a wildcard certificate. `*.<domain>` in the Caddyfile is a
hostname pattern that decides which requests a site block answers. With
`on_demand` set on that block Caddy does not fetch anything for the pattern
itself, it consults the ask endpoint per hostname. The Keycloak block carries
`force_automate` to state explicitly that its hostname is automated in its own
right, so it can never fall into the on-demand path where the ask endpoint would
refuse it. That is a guard against a dead sign-in and is harmless if Caddy would
have managed the name anyway.

The official `caddy` image is enough: no DNS access, no token, no image of our
own, no certificate file a human touches.

The answer is the address row's own existence, not "is there a live handout
here". An address outlives its handout by decision (`docs/adr/0022`,
`docs/adr/0023`), so an old link must still reach Handout's own page, which it
cannot do without a certificate. The ask endpoint is also asked again at
renewal, so an answer that flipped after a deletion would take the certificate
away from exactly those links. The ask route is for Caddy alone and every
Caddyfile in the repository blocks it on the public side.

### Rejected

- **A wildcard certificate over the DNS-01 challenge.** It needs API access to
  the DNS zone, which not every provider offers (one common German provider has
  one, another has none findable), and it needs a Caddy image with the provider
  module. Kept as a later option for an operator who publishes a great deal and
  can set it up.
- **A purchased certificate.** The permitted lifetime is falling across the
  industry: 200 days since March 2026, 100 from March 2027, 47 from March 2029.
  A certificate a human swaps stops being practical.
- **A proxy in front that brings its own certificate.** Every artifact would
  travel through a third party, and the product exists so the material stays on
  your own infrastructure.

### The numbers, checked on 2026-09-28

Let's Encrypt allows 50 new certificates per registered domain per 7 days.
Renewals are exempt through ARI, which Caddy has had since 2.8 and has on by
default. There are 300 new orders per account per 3 hours, and a raise is
applied for through a form. The deployment spends one certificate on the
publisher origin and a second on the identity provider when the bundled Keycloak
runs, so 49 or 48 new handouts a week are left at the start, not 50, and the
allowance refills over the window rather than resetting at a weekly boundary.

## Consequences

`docs/adr/0023` makes a never-issued address and a deleted one
indistinguishable in what Handout answers. That still holds: the page and its
headers are unchanged, and 0023 is not superseded. What this deployment adds
underneath is a difference in the transport. A name that was never issued gets
no certificate, so the handshake fails, while an address that was issued once
completes it and shows the 404 page. Someone who guesses a ten-character string
can therefore tell "was once issued" from "never issued", which costs the same
guess as finding the handout itself. It is accepted as the price of not handing
the weekly certificate quota to anyone who can spell a subdomain.

The first request to a new address takes about a second longer, because the
certificate is obtained in that moment. Losing Caddy's certificate store makes
every certificate be issued again, and that counts against the weekly limit.

A mistyped host under the pattern is refused by the ask endpoint, so in this
deployment it fails at TLS instead of starting a sign-in with a redirect URI
nobody registered. That is an observation, not a decision of this record.

The certificate flow was verified against the documentation and the source of
Caddy and CertMagic, and has not been run against a real domain.
