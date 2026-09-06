# Sample files

Everything needed to try the application by hand: one set of files per shape it
accepts, plus the ones it has to refuse. This is the only thing under `data/`
that is tracked — the rest is content, staging and incoming, all runtime state.

The files come in **pairs**. Publish `a`, then upload `b` as a new state of the
same handout, then `a` again — back and forth as often as you like. `a` is light
with a blue accent, `b` is dark with a red one, and each page carries a huge `A`
or `B`. Which state is live is therefore visible at a glance, through a second
tab, a reload and a browser cache.

| Directory          | Files                                       | The shape it stands for                                            |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `1-single-html/`   | `a.html` `b.html`                           | One self-contained file, nothing to resolve                         |
| `2-single-pdf/`    | `a.pdf` `b.pdf`                             | One page, A4 — the PDF branch, served inline                        |
| `3-zip-one-html/`  | `a.zip` `b.zip`                             | An archive that resolves on its own: `index.html` at the root       |
| `4-zip-many-html/` | `a.zip` `b.zip`                             | An ambiguous archive: three pages, no `index.html`                  |
| `4-zip-many-html/` | `c-entry-renamed.zip`                       | The same, but the chosen entry page is gone — not a pair            |
| `5-refused/`       | `no-html.zip`                               | An archive with no page in it at all                                |
| `5-refused/`       | `too-large.html` `progress-300mb.html`      | Over the ceiling, and big enough to watch the progress bar — not committed |

Every archive carries a `style.css` and an `assets/pixel.png` that its pages
reference relatively, so publishing one also shows that the artifact's own
assets resolve under the address, not just its entry page. The square is a real
64×64 PNG in the state's own accent colour, so it switches along with the page —
a stale state would show the wrong colour rather than nothing.

## The runs worth doing

**The basic loop**, with any pair. Publish `a`, copy the address, upload `b` as a
new state from the row's `⋯` menu. Same address, new content, new time in the
row. Then `a` again.

**The caching promise.** Keep the address open in a second tab. Upload the other
state. Reload that tab — the new state has to appear. A test suite proves this
one way; a browser proves it another, because the browser brings its own cache.

**The password.** Publish `a` with a password, unlock the address in a second
tab, then upload `b`. The unlock has to survive: no second prompt, and the
address and password unchanged.

**Protection covers everything.** Behind a password, `style.css` and the square
are unreachable too, not only the entry page. Ask for them directly and they
answer 401.

**The entry-page rule**, with `4-zip-many-html/`. Publish `a.zip`: three pages,
no `index.html`, so you are asked which one is the entry page. Pick
`overview.html`. Now upload `b.zip` — the same three names — and you are **not**
asked again: the entry is carried over, which is what the twentieth re-export of
the same site should feel like. Then upload `c-entry-renamed.zip`, where that
file is now `summary.html`, and only then does the question come back, because
the file it pointed at is gone. The pages link to each other, so you can also
check that the ones you did not choose stay reachable.

**Changing the entry page without uploading**, with `4-zip-many-html/a.zip`
again. Publish it and choose `overview.html`. From the row's `⋯` menu, "Change
the entry page" opens a panel in the row itself; pick `chapter-01/page.html`
and save. The address opens on that page now, with nothing uploaded, and the
time in the row does not move. A second tab that already had the address open
shows the new page on a plain reload, even with a warm cache.
`3-zip-one-html/` and `2-single-pdf/` are the rows where the menu never offers
the item at all — there is only ever one candidate to choose from.

**The refusals.** `5-refused/no-html.zip` is an archive with nothing to show.
`too-large.html` is over the ceiling. Anything that is neither zip, HTML nor PDF
is refused for its form. In every case the handout keeps the state it had.

## Rebuilding

They are generated, not hand-written, so a value that has to agree across nine
files is written down once:

    python3 data/testfiles/build.py

It replaces the five numbered directories and leaves this README, the script and
the oversize files alone. The oversize pair is written separately, because 800 MB
does not belong in a repository:

    python3 data/testfiles/build.py --large

Editing an archive by hand works too — zip the *contents*, not the containing
folder, or every path gains a level:

    cd <a scratch dir> && unzip -q ../a.zip
    # …edit…
    zip -qrX ../a.zip .
