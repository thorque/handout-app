# Sample archives

Small zip files, one per branch of the entry-file rule, for trying the upload
by hand and for integration tests. They are the only thing under `data/` that
is tracked — everything else there is a runtime directory or a local scratch
file.

Each archive carries a `style.css`, a `support.js` and an `assets/pixel.png`
that its pages reference relatively, so a published handout also proves that
the artifact's own assets resolve under the address, not just its entry page.

| Archive                     | Shape                                                                       | Expected outcome                                                     |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `with-root-index.zip`       | `index.html` at the root, next to a second page                              | Resolved without asking, `root: ""`, `entry: index.html`               |
| `single-wrapper-folder.zip` | Everything inside one `dist/` folder, `index.html` in it                     | Resolved without asking, `root: "dist"`, `entry: index.html`           |
| `multi-page-export.zip`     | Three pages at the root, no `index.html` there, plus `assets/index.html`     | Ambiguous — four candidates offered                                    |
| `many-pages.zip`            | Eleven pages across four chapter folders and the root                        | Ambiguous — eleven candidates, enough to bring up the filter field     |
| `no-html.zip`               | A text file and a JSON file, no page at all                                  | Refused, with the sentence naming what is expected                     |

## What the two ambiguous ones are for

`multi-page-export.zip` has the shape a multi-page export tool produces: several
pages side by side, an asset folder, and no entry page anyone declared. Its
`assets/index.html` is the interesting part — a folder that merely *happens* to
hold an `index.html` must not be mistaken for the artifact's wrapper folder
while real pages sit at the root, or the publisher would get that folder
published and their pages hidden, with nothing failing to warn them.

`many-pages.zip` crosses the threshold above which the selection offers a filter
field. Its paths are chosen so that filtering is worth doing: typing `chapter`
narrows eleven candidates to six, and picking `assets/index.html` first shows
that a selection survives a filter that would exclude it.

## Rebuilding them

Unpack, edit, zip the *contents* — not the containing folder, or every path
gains a level:

    cd <a scratch dir> && unzip -q <archive>.zip
    # …edit…
    zip -qrX ../<archive>.zip .

`-X` leaves out the local extra fields, so a rebuild on another machine gives a
comparable file.
