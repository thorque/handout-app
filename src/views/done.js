import { esc, page } from "./layout.js";
import { strings } from "./strings.js";

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

function copyField({ label, value, buttonLabel, copiedLabel, failedLabel }) {
  const reserves = RESERVED_LABELS.map(
    (reserved) =>
      `<span class="copy-field-button-reserve" aria-hidden="true">${esc(reserved)}</span>`,
  ).join("\n        ");

  return `<div class="copy-field" data-copy="${esc(value)}">
    <div class="copy-field-column">
      <span class="copy-field-label">${esc(label)}</span>
      <code class="copy-field-value">${esc(value)}</code>
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
</div>

<a class="another-button" href="/">${esc(strings["done.another"])}</a>
</div>`;

  return page({ title: "Handout", user, body, config });
}
