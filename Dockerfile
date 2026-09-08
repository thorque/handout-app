# Node 22, the version package.json's `engines` field requires. Debian slim
# rather than Alpine: none of the eight runtime dependencies compiles anything
# (no binding.gyp and no .node in the tree), so musl would buy a smaller image
# and nothing else, while glibc plus the full ICU this image carries removes a
# class of locale difference between here and a developer's machine.
FROM node:22-slim

# There is no build step and no bundler: what runs in production is the source
# in this repository, unchanged.
ENV NODE_ENV=production

WORKDIR /app

# The lockfile first, so a change under src/ reuses the installed layer.
COPY package.json package-lock.json ./
# --omit=dev: eslint and prettier are development tooling and never run in a
# container (docs/adr/0008-development-tooling-is-not-a-runtime-dependency.md).
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY migrations ./migrations
COPY LICENSE ./

# The `node` user ships with the image. HANDOUT_DATA_DIR is mounted at run
# time and has to be writable by this user; the application creates the
# directories under it itself at start (src/storage.js, ensureDataDirs).
USER node

# No EXPOSE: PORT is configuration without a default (CLAUDE.md), so there is
# no port this image could name honestly.
#
# The process installs no signal handler, so as PID 1 it does not stop on
# SIGTERM. Run it under an init — `docker run --init`, or `init: true` on the
# compose service.
#
# Not `npm start`: that script passes `--env-file=.env`, and node aborts with
# exit code 9 when the file is missing (verified). Every one of the twelve
# configuration values comes from the container environment instead
# (src/config.js names them all and aborts the start listing the missing ones).
CMD ["node", "src/server.js"]
