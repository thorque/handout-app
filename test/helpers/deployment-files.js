// Reading the deployment files as text, for test/compose.test.js and
// test/deployment.test.js. They are read as text, not parsed, because this
// project keeps its dependency list short by decision
// (docs/adr/0002-fastify-and-seven-more.md,
// docs/adr/0008-development-tooling-is-not-a-runtime-dependency.md) and a YAML
// parser would be a dependency bought for two tests. The cost is that the
// checks see the file, and only what the helpers below can tell about the
// service or the site block a line belongs to.

import fs from "node:fs";

export const read = (name) =>
  fs.readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

export const exists = (name) =>
  fs.existsSync(new URL(`../../${name}`, import.meta.url));

export const withoutComments = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

// KEY=value lines of an env file, as a Map from key to raw value.
export function parseEnv(text) {
  const entries = text
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]);
  return new Map(entries);
}

// The text of one service of a compose file: from its key at two spaces of
// indent to the next service key or the end of the services.
export function serviceBlock(composeText, name) {
  const lines = composeText.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`service ${name} not found`);
  let end = lines.findIndex(
    (line, i) => i > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line),
  );
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n");
}

// The site blocks of a Caddyfile: every top-level block whose address line
// ends in an opening brace, except snippets `(name) {` and the global options
// block, which is a bare `{`. Returns { address, text }.
export function siteBlocks(caddyText) {
  const lines = caddyText.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\S.*\{$/.test(line)) continue;
    if (line === "{" || line.startsWith("(")) continue;
    const end = lines.findIndex((l, j) => j > i && l === "}");
    blocks.push({
      address: line.slice(0, -2),
      text: lines.slice(i, end + 1).join("\n"),
    });
  }
  return blocks;
}
