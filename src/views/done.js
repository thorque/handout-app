import { esc, page } from "./layout.js";
import { strings } from "./strings.js";

export function renderDone({ user, config, title, address }) {
  const body = `
<div class="done-phase">
<h1>${esc(title)}</h1>
<p class="lead-wide">${esc(strings["done.lead"])}</p>

<div class="copy-grid">
  <div class="copy-field" data-copy="${esc(address)}">
    <div class="copy-field-column">
      <span class="copy-field-label">${esc(strings["done.addressLabel"])}</span>
      <code class="copy-field-value">${esc(address)}</code>
    </div>
    <button
      type="button"
      class="copy-field-button"
      data-copy-button
      data-copied-label="${esc(strings["done.copied"])}"
      data-copy-failed-label="${esc(strings["done.copyFailed"])}"
      aria-live="polite"
    >${esc(strings["done.copy"])}</button>
  </div>
</div>

<a class="another-button" href="/">${esc(strings["done.another"])}</a>
</div>`;

  return page({ title: "Handout", user, body, config });
}
