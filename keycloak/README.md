# Keycloak realm fixture

`realm.json` is a development fixture: its client secret and its user's
password are not secrets and exist only so the workbench is reproducible
without a manual setup step. A real deployment registers its own client at its
own identity provider and never uses this file.

`realm.production.json` is the other realm, for a deployment with the bundled
Keycloak (`docs/deployment.md`): no users, its client secret and its domain
taken from placeholders at import, `sslRequired` set to `external`. The two do
not collapse into one; an env file under `env/` names the one to import.
