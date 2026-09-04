# 3. One directory per address, and the entry file is recorded, never renamed

Date: 2026-09-04
Status: accepted

## Context

An artifact arrives as a zip, a single HTML file or a PDF and has to be served
under its address. A zip has no agreed shape: the entry page may sit at the root,
inside a single wrapper directory, or be the archive's only HTML file. Handout
never touches the artifact, so moving or renaming files inside it is not
available — a nav link pointing back at `Prototyp.html` must keep working. The
domain model has exactly two entities and no room for a third, so the entry
cannot become a column.

## Decision

The data directory is `$HANDOUT_DATA_DIR` with three children:

    content/<address>/          the live tree, one directory per address
    staging/<token>/            an upload assembled before it goes live
    incoming/<token>            the raw upload while it streams in

Inside `content/<address>/` the artifact is written exactly as it arrived, and a
reserved file `.handout` records where to start:

    {"root":"dist","entry":"index.html","kind":"zip","filename":"portal.zip"}

`root` is the directory that is served as `/` and `entry` the file served for the
address root, both relative to `content/<address>/`. Nothing in the archive is
moved or renamed. `.handout` is never served — the content handler refuses that
exact name with 404.

A zip's entry is resolved by the first rule that matches:

1. `index.html` at the archive root → root `""`, entry `index.html`
2. exactly one top-level directory and `<dir>/index.html` exists → root `<dir>`,
   entry `index.html` (extra files at the root are ignored)
3. exactly one `.html`/`.htm` member in the whole archive → root is its
   directory, entry its file name
4. otherwise the upload is refused with 422 and a sentence naming what is
   expected

A bare HTML file or a PDF is stored under its sanitised original name with root
`""` and that name as the entry.

## Decision on safety

Zip members are rejected, not sanitised: an absolute path, any `..` segment, a
backslash, or an entry that is neither a file nor a directory aborts the whole
upload with 422. The extraction target is re-checked with `path.resolve` against
the staging root for every member.

## Consequences

Serving `root` rather than the archive root means files outside the wrapper
directory are unreachable, which is correct for a wrapper and invisible for
everything else. Because nothing is moved, `.handout` is the single source of
truth for where an artifact starts, and HANDOUT-10's atomic replacement is one
`rename` of a staging directory over `content/<address>/` — the metadata travels
with the tree. The reserved name means an artifact that itself contains a
top-level `.handout` file cannot serve it; that is accepted.
