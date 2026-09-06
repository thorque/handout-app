import { esc, page } from "./layout.js";
import { strings, t } from "./strings.js";
import { suggestPassword } from "../password.js";

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const trimmed = mb.endsWith(".0") ? mb.slice(0, -2) : mb;
    return `${trimmed} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export function renderNewHandout({
  user,
  config,
  fileError,
  titleError,
  passwordError,
  title,
  protect = true,
  password,
}) {
  const limit = formatBytes(config.maxUploadBytes);
  const passwordValue = password || suggestPassword();

  const body = `
<h1>${esc(strings["form.heading"])}</h1>
<p class="lead">${esc(strings["form.lead"])}</p>
${
  fileError
    ? `<p class="drop-message drop-message-standalone" role="alert" data-server-message><span aria-hidden="true" class="drop-message-icon">${esc(strings["error.icon"])}</span>${esc(fileError)}</p>`
    : ""
}

<form method="post" action="/handouts" enctype="multipart/form-data" data-publish-form>
  <div
    class="drop-area${fileError ? " error" : ""}"
    data-drop-area
    data-max-upload-bytes="${config.maxUploadBytes}"
    data-headline="${esc(strings["drop.headline"])}"
    data-headline-dragging="${esc(strings["drop.headlineDragging"])}"
    data-replace-label="${esc(strings["drop.replace"])}"
    data-too-large="${esc(strings["error.tooLargeClient"])}"
    data-unsupported="${esc(strings["error.unsupported"])}"
    data-message-icon="${esc(strings["error.icon"])}"
  >
    <div class="drop-empty" data-drop-empty>
      <div class="drop-headline" data-drop-headline>${esc(strings["drop.headline"])}</div>
      <div class="drop-hint">${esc(t("drop.hint", { limit }))}</div>
      <button type="button" class="drop-pick-button" data-pick>${esc(strings["drop.pick"])}</button>
    </div>
    <div class="drop-filled" data-drop-filled hidden>
      <div class="drop-filled-name" data-filled-name></div>
      <div class="drop-filled-size" data-filled-size></div>
      <button type="button" class="drop-replace-button" data-replace>${esc(strings["drop.replace"])}</button>
    </div>
    <div class="drop-message" data-drop-message role="alert" hidden></div>
    <input
      type="file"
      name="file"
      accept=".zip,.html,.htm,.pdf"
      tabindex="-1"
      aria-hidden="true"
      class="drop-file-input"
      data-file-input
    >
  </div>

  <!-- Occupies the drop area's own slot during a transfer — hidden/shown as
       the exact counterpart of .drop-area above, never both visible at
       once. No heading of its own: the page's own "New handout" and lead
       above stay visible throughout, so this needs no context of its own. -->
  <div class="upload-phase" data-upload-box hidden>
    <div class="upload-box">
      <div class="upload-row">
        <span data-upload-file></span>
        <span data-upload-percent>0%</span>
      </div>
      <div class="upload-track">
        <div class="upload-fill" data-upload-fill></div>
      </div>
    </div>
    <!-- Not in the design (the prototype's uploading phase has no cancel
         at all) — the maintainer asked for one anyway: abort the transfer
         and leave for the dashboard. Placed where the prototype's own
         "Der Austausch am Ende ist atomar." paragraph sits, a slot this
         product does not render, hence the same top margin instead of a
         paragraph. -->
    <button
      type="button"
      class="cancel-button upload-cancel-button"
      data-upload-cancel
      hidden
    >${esc(strings["upload.cancel"])}</button>
  </div>

  <!-- Hidden alongside the drop area during a transfer, not disabled: the
       title is already in the request by then, so an editable field whose
       value no longer does anything is a small lie, and a disabled field is
       a state the reader has to parse — the design brief asks for neither.
       Nothing above this point moves, so hiding content at the end of the
       form is still not a layout jump. -->
  <div class="field" data-field>
    <label for="title">${esc(strings["title.label"])}</label>
    <input
      type="text"
      id="title"
      name="title"
      required
      maxlength="200"
      placeholder="${esc(strings["title.placeholder"])}"
      value="${esc(title || "")}"
      class="${titleError ? "field-input-error" : ""}"
      data-title-input
    >
    <div class="field-hint${titleError ? " field-hint-error" : ""}">${esc(titleError || strings["title.hint"])}</div>
  </div>

  <div class="protect-block">
    <label for="protect" class="protect-label">
      <input type="checkbox" id="protect" name="protect" class="protect-checkbox" ${protect ? "checked" : ""}>
      <span>
        <span class="protect-label-text">${esc(strings["form.protectLabel"])}</span>
        <span class="protect-hint">${esc(strings["form.protectHint"])}</span>
      </span>
    </label>
    <div class="password-block" data-password-block${protect ? "" : " hidden"}>
      <label for="password" class="password-label">${esc(strings["form.passwordLabel"])}</label>
      <div class="password-row">
        <input
          type="text"
          id="password"
          name="password"
          maxlength="200"
          value="${esc(passwordValue)}"
          class="password-input${passwordError ? " field-input-error" : ""}"
        >
        <button type="button" class="password-suggest-button" data-suggest-password>${esc(strings["form.passwordSuggest"])}</button>
      </div>
      <div class="field-hint${passwordError ? " field-hint-error" : ""}">${
        passwordError
          ? `<span aria-hidden="true" class="drop-message-icon">${esc(strings["error.icon"])}</span>${esc(passwordError)}`
          : esc(strings["form.passwordHint"])
      }</div>
    </div>
  </div>

  <div class="form-actions">
    <button
      type="submit"
      class="publish-button form-publish-button"
      disabled
      data-publish-button
      data-label-ready="${esc(strings["publish.ready"])}"
      data-label-no-file="${esc(strings["publish.noFile"])}"
      data-label-no-title="${esc(strings["publish.noTitle"])}"
      data-label-no-password="${esc(strings["publish.noPassword"])}"
    >${esc(strings["publish.noFile"])}</button>
    <a class="cancel-button" href="/" data-form-cancel>${esc(strings["form.cancel"])}</a>
  </div>
</form>`;

  return page({ title: "Handout", user, body, config });
}
