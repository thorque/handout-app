# Keycloak realm fixture

`realm.json` is a development fixture: its client secret and its user's
password are not secrets and exist only so the workbench is reproducible
without a manual setup step. A real deployment registers its own client at its
own identity provider and never uses this file.

`realm.production.json` is the other realm, for a deployment with the bundled
Keycloak (`docs/deployment.md`): no users, its client secret and its domain
taken from placeholders at import, `sslRequired` set to `external`. The two do
not collapse into one; an env file under `env/` names the one to import.

Both realms define the client role `publisher` on `handout-web` and a mapper
that writes the person's roles of that client into the ID token's top-level
`roles` claim, which is what the application checks against
`OIDC_REQUIRED_ROLE` (docs/adr/0034). The fixture's two users have the role; a
publisher created in the production realm needs it assigned.
