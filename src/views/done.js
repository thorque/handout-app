import { esc, page } from "./layout.js";
import { strings } from "./strings.js";
import { messageText } from "../message.js";

// Every label a copy handle can end up showing, in one list. Each handle
// reserves the width of all of them, so the two buttons come out identical in
// width and neither one resizes when its receipt replaces its label — the
// receipt is a two-second swap, and a button that grows for it drags the field
// next to it along. Deliberately without the copy-failed sentences: reserving a
// whole sentence would widen both buttons permanently for the one path that
// almost never runs, and there the message widening the button is the message
// doing its job.
const RESERVED_LABELS = [
  strings["done.copy"],
  strings["done.copied"],
  strings["done.copyPassword"],
  strings["done.passwordCopied"],
];

// The combined handle's own reserve set, not RESERVED_LABELS: the two field
// buttons are deliberately narrower (min-width:112px) than the combined
// handle (min-width:268px), and joining the shared list would drag both
// field buttons out to the combined handle's width.
const MESSAGE_RESERVED_LABELS = [
  strings["done.copyBoth"],
  strings["done.bothCopied"],
];

function reserveSpans(labels) {
  return labels
    .map(
      (reserved) =>
        `<span class="copy-field-button-reserve" aria-hidden="true">${esc(reserved)}</span>`,
    )
    .join("\n        ");
}

// The component renders the value as a link when it is an http(s) address and
// as plain text otherwise (Kopierfeld.dc.html, the isLink / isPlain branches).
// Here the caller says which field it is instead of the value being sniffed:
// this view knows that the address is a URL and the password never is, and a
// password someone chose to be "https://…" would otherwise turn into a link to
// nowhere. Same result for every value that actually occurs, one trap fewer.
function copyField({
  label,
  value,
  link = false,
  buttonLabel,
  copiedLabel,
  failedLabel,
}) {
  const reserves = reserveSpans(RESERVED_LABELS);

  // rel="noreferrer" is the component's own attribute and it is the one that
  // matters here: it implies noopener, so the artifact opening in the new tab
  // gets no handle on the page that opened it. The artifact is a stranger's
  // finished file, and Handout never runs inside it.
  const renderedValue = link
    ? `<a class="copy-field-value copy-field-link" href="${esc(value)}" target="_blank" rel="noreferrer">${esc(value)}</a>`
    : `<code class="copy-field-value">${esc(value)}</code>`;

  return `<div class="copy-field" data-copy="${esc(value)}">
    <div class="copy-field-column">
      <span class="copy-field-label">${esc(label)}</span>
      ${renderedValue}
    </div>
    <button
      type="button"
      class="copy-field-button"
      data-copy-button
      data-copied-label="${esc(copiedLabel)}"
      data-copy-failed-label="${esc(failedLabel)}"
      aria-live="polite"
    ><span class="copy-field-button-stack">
        <span class="copy-field-button-label" data-copy-label>${esc(buttonLabel)}</span>
        ${reserves}
      </span></button>
  </div>`;
}

// The combined handle: a third row of the copy grid, sibling of the two
// Kopierfeld rows, with a button and no label/value column. Rendered
// `hidden` — revealed by initCopyMessage() in src/public/handout.js —
// because without JavaScript there is no clipboard, and the handle must be
// absent rather than dead while address and password stay readable in their
// own rows regardless.
function copyMessageRow(address, password) {
  const text = messageText(address, password);
  if (!text) return "";

  const value = esc(text).replace(/\n/g, "&#10;");
  const reserves = reserveSpans(MESSAGE_RESERVED_LABELS);

  return `<div class="copy-field copy-message" hidden data-copy-message-row data-copy="${value}">
    <button
      type="button"
      class="copy-message-button"
      data-copy-button
      data-copied-label="${esc(strings["done.bothCopied"])}"
      data-copy-failed-label="${esc(strings["done.copyBothFailed"])}"
      aria-live="polite"
    ><span class="copy-field-button-stack">
        <span class="copy-field-button-label" data-copy-label>${esc(strings["done.copyBoth"])}</span>
        ${reserves}
      </span></button>
  </div>`;
}

export function renderDone({ user, config, title, address, password }) {
  const lead = password ? strings["done.leadProtected"] : strings["done.lead"];

  const body = `
<div class="done-phase">
<h1>${esc(title)}</h1>
<p class="lead-wide">${esc(lead)}</p>

<div class="copy-grid">
  ${copyField({
    label: strings["done.addressLabel"],
    value: address,
    link: true,
    buttonLabel: strings["done.copy"],
    copiedLabel: strings["done.copied"],
    failedLabel: strings["done.copyFailed"],
  })}
  ${
    password
      ? copyField({
          label: strings["done.passwordLabel"],
          value: password,
          buttonLabel: strings["done.copyPassword"],
          copiedLabel: strings["done.passwordCopied"],
          failedLabel: strings["done.passwordCopyFailed"],
        })
      : ""
  }
  ${copyMessageRow(address, password)}
</div>

<div class="done-actions">
  <a class="primary-button" href="/">${esc(strings["done.toDashboard"])}</a>
  <a class="another-button done-action" href="/handouts/new">${esc(strings["done.another"])}</a>
</div>
</div>`;

  return page({ title: "Handout", user, body, config });
}
