import { esc, page } from "./layout.js";
import { strings, t } from "./strings.js";
import { utcStamp } from "./stamp.js";
import { messageText } from "../message.js";
import { PASSWORD_MAX_LENGTH } from "../password.js";

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

// Both badges are always rendered, the inapplicable one carrying `hidden` —
// the component's isProtected / isOpen are mutually exclusive, so exactly
// one is ever visible, and the pair is what lets the row change in place
// after a password save without a re-render (docs/adr/0026). The word
// carries the state; the 8x8 square next to it is aria-hidden and adds
// nothing a reader needs.
function badge(protect) {
  return `<span class="handout-row-badge handout-row-badge-protected"${protect ? "" : " hidden"} data-row-badge-protected><span class="handout-row-badge-mark" aria-hidden="true"></span>${esc(strings["row.protected"])}</span>
        <span class="handout-row-badge handout-row-badge-open"${protect ? " hidden" : ""} data-row-badge-open><span class="handout-row-badge-mark handout-row-badge-mark-open" aria-hidden="true"></span>${esc(strings["row.open"])}</span>`;
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
function rowMenu({
  address,
  href,
  password,
  canChangeEntry,
  title,
  rawAddress,
}) {
  const menuId = `row-menu-${address}`;
  // messageText(href, null) is null on an open row — esc(null) would
  // otherwise render the four letters "null" into the attribute, so the
  // value is computed only when there is a password to compose one from.
  const messageValue = password
    ? esc(messageText(href, password)).replace(/\n/g, "&#10;")
    : "";

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
          data-row-copy-both
          data-copy="${messageValue}"
          data-copied-label="${esc(strings["row.bothCopied"])}"
          data-copy-failed-label="${esc(strings["row.copyBothFailed"])}"
          aria-live="polite"
          ${password ? "" : "hidden"}
        >${esc(strings["row.copyBoth"])}</button>
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-copy-button
          data-row-copy-password
          data-copy="${esc(password || "")}"
          data-copied-label="${esc(strings["row.passwordCopied"])}"
          data-copy-failed-label="${esc(strings["row.copyPasswordFailed"])}"
          aria-live="polite"
          ${password ? "" : "hidden"}
        >${esc(strings["row.copyPassword"])}</button>
        ${
          canChangeEntry
            ? `<button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-row-entry-item
        >${esc(strings["row.changeEntry"])}</button>`
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
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item"
          data-row-password-item
          data-label-protected="${esc(strings["row.newPassword"])}"
          data-label-open="${esc(strings["row.setPassword"])}"
        >${esc(password ? strings["row.newPassword"] : strings["row.setPassword"])}</button>
        <button
          type="button"
          role="menuitem"
          class="handout-row-menu-item handout-row-menu-item-danger"
          data-row-delete
          data-delete-url="/handouts/${esc(rawAddress)}/delete"
          data-delete-title="${esc(title)}"
          data-delete-address="${esc(address)}"
        >${esc(strings["row.delete"])}</button>
      </div>`;
}

// The row's inline "change the entry page" panel — skeleton only, rendered
// hidden. The list of radio rows is not rendered here at all: it is fetched
// when the panel opens (docs/adr/0021), so the markup per row stays constant
// regardless of how many pages the archive holds. Only rendered when
// canChangeEntry, exactly like the menu item above.
function entryPanel(rawAddress) {
  const group = `entry-${rawAddress}`;
  const filterId = `${group}-filter`;

  return `<div class="handout-row-entry" data-row-entry-panel hidden>
    <fieldset class="handout-row-entry-fieldset">
      <legend>${esc(strings["row.entryLegend"])}</legend>
      <p
        class="handout-row-entry-description"
        data-row-entry-description
        data-template-current="${esc(strings["row.entryDescription"])}"
        data-template-none="${esc(strings["row.entryDescriptionNone"])}"
      ></p>
      <div class="handout-row-entry-filter" hidden data-row-entry-filter>
        <label for="${esc(filterId)}">${esc(strings["row.entryFilterLabel"])}</label>
        <input
          type="search"
          id="${esc(filterId)}"
          placeholder="${esc(strings["row.entryFilterPlaceholder"])}"
          data-row-entry-filter-input
        >
        <span
          data-row-entry-filter-count
          data-template-all="${esc(strings["row.entryFilterCountAll"])}"
          data-template-some="${esc(strings["row.entryFilterCountSome"])}"
          data-template-some-pinned="${esc(strings["row.entryFilterCountSomePinned"])}"
        ></span>
      </div>
      <div class="handout-row-entry-list" data-row-entry-list>
        <p class="handout-row-entry-no-match" hidden data-row-entry-no-match>${esc(strings["row.entryNoMatch"])}</p>
      </div>
    </fieldset>
    <p class="handout-row-entry-note">${esc(strings["row.entryNote"])}</p>
    <div class="handout-row-entry-actions">
      <button
        type="button"
        class="handout-row-entry-save"
        data-row-entry-save
        disabled
        data-label-ready="${esc(strings["row.entrySave"])}"
        data-label-unchanged="${esc(strings["row.entrySaveUnchanged"])}"
      >${esc(strings["row.entrySaveUnchanged"])}</button>
      <button type="button" class="handout-row-entry-cancel" data-row-entry-cancel>${esc(strings["row.entryCancel"])}</button>
    </div>
  </div>`;
}

// The row's inline "issue a new password" panel — rendered on every row,
// unlike entryPanel() above, which is conditional (docs/adr/0026): a free
// row offers "Set a password" just as much as a protected one offers "Issue
// a new password". The design gives the field no visible label — the
// panel's bold heading is its name — so aria-labelledby points at that
// heading rather than inventing a label the design does not have.
// aria-describedby names both the permanent hint and the hidden error span
// from the start; a hidden element is not announced, so no attribute
// juggling is needed when the refusal appears. The heading and note do not
// swap between a protected and a free row: HandoutZeile.dc.html writes both
// as literals, not as placeholders (docs/adr/0025's assumption).
function passwordPanel(rawAddress) {
  const hintId = `row-password-hint-${rawAddress}`;
  const errorId = `row-password-error-${rawAddress}`;
  return `<div class="handout-row-password" data-row-password-panel hidden>
    <div class="handout-row-password-heading" id="row-password-heading-${esc(rawAddress)}">${esc(strings["row.passwordHeading"])}</div>
    <p class="handout-row-password-note">${esc(strings["row.passwordNote"])}</p>
    <div class="handout-row-password-row">
      <input
        type="text"
        class="handout-row-password-input"
        maxlength="${PASSWORD_MAX_LENGTH}"
        autocomplete="off"
        spellcheck="false"
        aria-labelledby="row-password-heading-${esc(rawAddress)}"
        aria-describedby="${esc(hintId)} ${esc(errorId)}"
        data-row-password-input
      >
      <button type="button" class="handout-row-password-save" data-row-password-save>${esc(strings["row.passwordSave"])}</button>
      <button type="button" class="handout-row-password-cancel" data-row-password-cancel>${esc(strings["row.passwordCancel"])}</button>
    </div>
    <!-- Reuses .field-hint (docs/adr/0025): the design system's own "Feld"
         section gives its under-field hint slot exactly 13px in
         var(--ink-faint), and that is this line's whole style. Permanent,
         not replaced by the error below it — an empty field is not a
         refusal any more, so the only remaining errors (too long, unknown
         address) get their own separate span underneath. -->
    <p class="field-hint handout-row-password-hint" id="${esc(hintId)}" data-row-password-hint>${esc(strings["row.passwordRemoveHint"])}</p>
    <span class="field-hint field-hint-error handout-row-password-error" id="${esc(errorId)}" hidden data-row-password-error></span>
  </div>`;
}

// The sentence's word order stays in strings.js; the two values are filled in
// by the script with textContent when the dialog opens (docs/adr/0024). The
// template is escaped first — it carries no HTML — and the two placeholders,
// which no escaping touches, are then replaced by the empty spans.
function deleteSentence() {
  return esc(strings["dash.deleteSentence"])
    .replace("{title}", "<span data-delete-dialog-title></span>")
    .replace(
      "{address}",
      '<span class="delete-dialog-address" data-delete-dialog-address></span>',
    );
}

function row({
  title,
  address,
  rawAddress,
  href,
  password,
  updatedAt,
  canChangeEntry,
}) {
  const reserves = reserveSpans(ADDRESS_RESERVED_LABELS);

  return `<div class="handout-row" data-handout-row data-upload-url="/handouts/${esc(rawAddress)}/state" data-entry-url="/handouts/${esc(rawAddress)}/entry" data-password-url="/handouts/${esc(rawAddress)}/password">
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
      ${rowMenu({ address, href, password, canChangeEntry, title, rawAddress })}
    </div>
  </div>
  <div class="handout-row-upload" data-row-upload-box hidden>
    <div class="upload-row"><span data-row-upload-file></span><span data-row-upload-percent>0 %</span></div>
    <div class="upload-track"><div class="upload-fill" data-row-upload-fill></div></div>
  </div>
  ${canChangeEntry ? entryPanel(rawAddress) : ""}
  ${passwordPanel(rawAddress)}
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
</div>

${
  empty
    ? ""
    : `<dialog class="delete-dialog" data-delete-dialog aria-labelledby="delete-dialog-heading">
  <form method="post" data-delete-dialog-form>
    <h2 class="delete-dialog-heading" id="delete-dialog-heading">${esc(strings["dash.deleteHeading"])}</h2>
    <p class="delete-dialog-text">${deleteSentence()}</p>
    <div class="delete-dialog-actions">
      <button type="submit" class="delete-dialog-confirm">${esc(strings["dash.deleteConfirm"])}</button>
      <button type="button" class="delete-dialog-cancel" data-delete-dialog-cancel autofocus>${esc(strings["dash.deleteCancel"])}</button>
    </div>
  </form>
</dialog>`
}

<template data-row-entry-template><label class="handout-row-entry-row"><input type="radio"><span></span></label></template>`;

  return page({ title: "Handout", user, body, config });
}
