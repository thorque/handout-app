import { esc, page } from "./layout.js";
import { strings } from "./strings.js";
import { VIEWER_PREFIX, VIEWER_ASSET_PREFIX } from "../protection.js";

// The viewer's password page. No header, no wordmark, no client script: the
// design system says the header does not exist on the viewer side, and the
// story says no branding — see docs/adr/0010.
// `config` is accepted (every caller passes it, matching the shared view
// signature) but not read here — nothing on this page currently varies by
// configuration.
export function renderPasswordPage({ error = false, config }) {
  const body = `
<h1 class="viewer-heading">${esc(strings["viewer.heading"])}</h1>
<p class="viewer-lead">${esc(strings["viewer.lead"])}</p>

<form method="post" action="${VIEWER_PREFIX}password" class="viewer-field">
  <label for="viewer-password">${esc(strings["viewer.passwordLabel"])}</label>
  <input
    type="password"
    id="viewer-password"
    name="password"
    class="viewer-input${error ? " error" : ""}"
  >
  ${
    error
      ? `<span class="viewer-message"><span aria-hidden="true" class="drop-message-icon">${esc(strings["error.icon"])}</span>${esc(strings["error.passwordWrong"])}</span>`
      : ""
  }
  <button type="submit" class="viewer-submit">${esc(strings["viewer.submit"])}</button>
</form>`;

  return page({
    title: "Handout",
    user: undefined,
    body,
    config,
    assetPrefix: VIEWER_ASSET_PREFIX,
    clientScript: false,
    mainClass: "viewer-page",
  });
}
