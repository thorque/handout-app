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

// The `⋯` menu and its toggle — rendered on every row now, protected or
// not: the design's list note says "Ohne Passwort fällt der Menüpunkt
// „Passwort kopieren" weg" — without a password only that *item* drops
// out, not the menu itself (designsystem-progress-and-error.excerpt.html,
// section "Liste"). What made the menu password-only before this story was
// that it held nothing else; this story is what first puts an item in it
// that every row gets, protected or open.
// Rendered `hidden`: every item in it is script-only (clipboard, or a file
// picker triggered by script), so the toggle is revealed only once the
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
        ${
          password
            ? `<button
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
        >${esc(strings["row.copyPassword"])}</button>`
            : ""
        }
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-row-upload
        >${esc(strings["row.uploadState"])}</button>
        <input
          type="file"
          id="row-upload-${esc(address)}"
          class="handout-row-file-input"
          tabindex="-1"
          aria-hidden="true"
          data-row-file-input
        >
      </div>`;
}

function row({ title, address, rawAddress, href, password, updatedAt }) {
  const reserves = reserveSpans(ADDRESS_RESERVED_LABELS);

  return `<div class="handout-row" data-handout-row data-upload-url="/handouts/${esc(rawAddress)}/state">
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
      ${rowMenu({ address, href, password })}
    </div>
  </div>
  <div class="handout-row-upload" data-row-upload-box hidden>
    <div class="upload-row"><span data-row-upload-file></span><span data-row-upload-percent>0 %</span></div>
    <div class="upload-track"><div class="upload-fill" data-row-upload-fill></div></div>
  </div>
  <div class="handout-row-message" data-row-upload-message hidden aria-live="polite"></div>
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

<div
  class="handout-list"
  data-handout-list
  data-max-upload-bytes="${config.maxUploadBytes}"
  data-too-large="${esc(strings["error.tooLargeClient"])}"
  data-unsupported="${esc(strings["error.unsupported"])}"
  data-message-icon="${esc(strings["error.icon"])}"
>
${handouts.map(row).join("\n")}
</div>`;

  return page({ title: "Handout", user, body, config });
}
