import { esc, page } from "./layout.js";
import { strings, t } from "./strings.js";
import { utcStamp } from "./stamp.js";
import { messageText } from "../message.js";

// Every label the row's address handle can end up showing, mirrored from
// RESERVED_LABELS in src/views/done.js: only the two the button actually
// swaps between, not the failure sentence (see the comment above
// RESERVED_LABELS there for why).
const ADDRESS_RESERVED_LABELS = [
  strings["row.copyAddress"],
  strings["row.addressCopied"],
];

function reserveSpans(labels) {
  return labels
    .map(
      (reserved) =>
        `<span class="copy-field-button-reserve" aria-hidden="true">${esc(reserved)}</span>`,
    )
    .join("\n        ");
}

// Exactly one badge per row — the component's isProtected / isOpen are
// mutually exclusive. The word carries the state; the 8x8 square next to it
// is aria-hidden and adds nothing a reader needs.
function badge(protect) {
  if (protect) {
    return `<span class="handout-row-badge handout-row-badge-protected"><span class="handout-row-badge-mark" aria-hidden="true"></span>${esc(strings["row.protected"])}</span>`;
  }
  return `<span class="handout-row-badge handout-row-badge-open"><span class="handout-row-badge-mark handout-row-badge-mark-open" aria-hidden="true"></span>${esc(strings["row.open"])}</span>`;
}

// The `⋯` menu and its toggle — rendered only for a protected handout,
// because the two items this story builds (the combined handle and the
// password handle) are both password items, and a menu with nothing in it
// would be worse than no menu at all. Everything else the design's menu
// carries (upload a new state, change the entry page, reissue the
// password, delete) belongs to later stories.
// Rendered `hidden`: both items are clipboard-only and there is no
// clipboard without JavaScript, so the toggle is revealed only once the
// script has wired the menu up (initRowMenu() in src/public/handout.js) —
// the same treatment the combined handle on the result page gets.
function rowMenu({ address, href, password }) {
  const menuId = `row-menu-${address}`;
  const messageValue = esc(messageText(href, password)).replace(/\n/g, "&#10;");

  return `<button
        type="button"
        class="handout-row-menu-button"
        hidden
        data-row-menu-toggle
        aria-label="${esc(strings["row.menu"])}"
        aria-expanded="false"
        aria-controls="${esc(menuId)}"
      >⋯</button>
      <div class="handout-row-menu" id="${esc(menuId)}" role="menu" hidden data-row-menu>
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-copy-button
          data-copy="${messageValue}"
          data-copied-label="${esc(strings["row.bothCopied"])}"
          data-copy-failed-label="${esc(strings["row.copyBothFailed"])}"
          aria-live="polite"
        >${esc(strings["row.copyBoth"])}</button>
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-copy-button
          data-copy="${esc(password)}"
          data-copied-label="${esc(strings["row.passwordCopied"])}"
          data-copy-failed-label="${esc(strings["row.copyPasswordFailed"])}"
          aria-live="polite"
        >${esc(strings["row.copyPassword"])}</button>
      </div>`;
}

function row({ title, address, href, password, updatedAt }) {
  const reserves = reserveSpans(ADDRESS_RESERVED_LABELS);

  return `<div class="handout-row">
  <div class="handout-row-inner">
    <div class="handout-row-main">
      <span class="handout-row-title">${esc(title)}</span>
      <div class="handout-row-meta">
        ${badge(!!password)}
        <a class="handout-row-address" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(address)}</a>
      </div>
      <div class="handout-row-stamp">${esc(strings["row.lastState"])} <time datetime="${esc(updatedAt.toISOString())}" data-local-stamp>${esc(t("stamp.utc", { stamp: utcStamp(updatedAt) }))}</time></div>
    </div>
    <div class="handout-row-actions">
      <button
        type="button"
        class="handout-row-copy-button"
        data-copy-button
        data-copy="${esc(href)}"
        data-copied-label="${esc(strings["row.addressCopied"])}"
        data-copy-failed-label="${esc(strings["row.copyAddressFailed"])}"
        aria-live="polite"
      ><span class="copy-field-button-stack">
        <span class="copy-field-button-label" data-copy-label>${esc(strings["row.copyAddress"])}</span>
        ${reserves}
      </span></button>
      ${password ? rowMenu({ address, href, password }) : ""}
    </div>
  </div>
</div>`;
}

export function renderDashboard({ user, config, handouts }) {
  const empty = handouts.length === 0;
  const countSentence = empty
    ? strings["dash.countNone"]
    : handouts.length === 1
      ? strings["dash.countOne"]
      : t("dash.countMany", { count: handouts.length });

  const body = `
<div class="dash-head">
  <div>
    <h1>${esc(strings["dash.heading"])}</h1>
    <p class="lead-wide">${esc(countSentence)}</p>
  </div>
  <a class="primary-button" href="/handouts/new">${esc(strings["dash.new"])}</a>
</div>

${
  empty
    ? `<div class="dash-empty"><p class="dash-empty-text">${esc(strings["dash.empty"])}</p></div>`
    : ""
}

<div class="handout-list">
${handouts.map(row).join("\n")}
</div>`;

  return page({ title: "Handout", user, body, config });
}
