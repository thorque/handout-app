import { esc, page } from "./layout.js";
import { strings, t } from "./strings.js";

// The entry-choice screen — shown only when a zip holds several HTML files
// and no index.html — and the stateless rejected screen for a zip with no
// HTML file at all. Layout from the prototype's `neuEntry` / `neuRejected`
// blocks (design-sources/Handout-Prototyp--neues-handout.dc.html); the
// fieldset and its rules from the design system's "Startseitenauswahl"
// section (design-sources/Handout-Designsystem--relevant-sections.dc.html).
// See docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md.

function summaryLine(title, protect) {
  return `${title} · ${protect ? strings["entry.summaryProtected"] : strings["entry.summaryOpen"]}`;
}

export function renderEntryChoice({
  user,
  config,
  token,
  filename,
  title,
  protect,
  candidates,
  selected,
  error,
}) {
  const showFilter = candidates.length > 8;

  const rows = candidates
    .map((candidatePath, i) => {
      const id = `entry-${i}`;
      const checked = selected === candidatePath ? " checked" : "";
      return `      <label for="${id}" class="entry-row">
        <input type="radio" name="entry" id="${id}" value="${esc(candidatePath)}"${checked}>
        <span>${esc(candidatePath)}</span>
      </label>`;
    })
    .join("\n");

  const body = `
<h1>${esc(strings["form.heading"])}</h1>
<p class="lead">${esc(strings["entry.lead"])}</p>

<div class="entry-summary">
  <span class="entry-summary-file">${esc(filename)}</span>
  <span class="entry-summary-line">${esc(summaryLine(title, protect))}</span>
  ${
    selected
      ? `<span class="entry-summary-chosen">${esc(strings["entry.chosen"])} <span class="entry-summary-path">${esc(selected)}</span></span>`
      : ""
  }
</div>

<form method="post" action="/handouts/entry/${esc(token)}">
  <fieldset class="entry-fieldset">
    <legend>${esc(strings["entry.legend"])}</legend>
    <p class="entry-hint">${esc(strings["entry.hint"])}</p>

    ${
      showFilter
        ? `<div class="entry-filter" hidden data-entry-filter>
      <label for="entry-filter-input">${esc(strings["entry.filterLabel"])}</label>
      <input
        type="search"
        id="entry-filter-input"
        placeholder="${esc(strings["entry.filterPlaceholder"])}"
        data-entry-filter-input
      >
      <span
        data-entry-filter-count
        data-template-all="${esc(strings["entry.filterCountAll"])}"
        data-template-some="${esc(strings["entry.filterCountSome"])}"
        data-template-some-pinned="${esc(strings["entry.filterCountSomePinned"])}"
      >${esc(t("entry.filterCountAll", { total: candidates.length }))}</span>
    </div>`
        : ""
    }

    <div class="entry-list">
${rows}
      <p class="entry-no-match" hidden data-entry-no-match>${esc(strings["entry.noMatch"])}</p>
    </div>
  </fieldset>

  ${
    error
      ? `<div class="field-hint field-hint-error entry-error" role="alert"><span aria-hidden="true" class="drop-message-icon">${esc(strings["error.icon"])}</span>${esc(error)}</div>`
      : ""
  }

  <div class="entry-actions">
    <button
      type="submit"
      class="publish-button entry-publish-button"
      data-entry-publish
      data-label-ready="${esc(strings["publish.ready"])}"
      data-label-no-entry="${esc(strings["publish.noEntry"])}"
    >${esc(strings["publish.ready"])}</button>
    <button type="submit" name="cancel" value="1" formnovalidate class="cancel-button">${esc(strings["entry.cancel"])}</button>
  </div>
</form>`;

  return page({ title: "Handout", user, body, config });
}

export function renderRejected({ user, config }) {
  const body = `
<h1>${esc(strings["form.heading"])}</h1>
<p class="lead">${esc(strings["rejected.lead"])}</p>
<div class="rejected-message" role="alert"><span aria-hidden="true" class="rejected-message-icon">${esc(strings["error.icon"])}</span><span>${esc(strings["error.noHtml"])}</span></div>
<div class="done-actions">
  <a class="another-button done-action" href="/handouts/new">${esc(strings["rejected.chooseAnother"])}</a>
  <a class="cancel-button" href="/">${esc(strings["rejected.cancel"])}</a>
</div>`;

  return page({ title: "Handout", user, body, config });
}
