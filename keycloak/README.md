# Keycloak realm fixture

`realm.json` is a development fixture: its client secret and its user's
password are not secrets and exist only so the workbench is reproducible
without a manual setup step. A real deployment registers its own client at its
own identity provider and never uses this file.
