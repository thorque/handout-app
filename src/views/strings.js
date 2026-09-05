// Every user-visible string lives here, one flat module, per
// docs/adr/0006-english-interface-collected-strings.md. No literal belongs in
// a template, a route or the client JavaScript.

export const strings = {
  // header
  "header.profile": "Profile and settings", // aria-label
  "header.appearance": "Appearance", // rendered uppercase by CSS
  "header.themeLight": "Light",
  "header.themeDark": "Dark",
  "header.themeSystem": "System",
  "header.signOut": "Sign out",

  // form phase
  "form.heading": "New handout",
  "form.lead": "Upload a file, enter a title, hand out the address.",
  "drop.headline": "Drag a file here",
  "drop.headlineDragging": "Release to take it",
  "drop.hint": "Zip, HTML or PDF · up to {limit}",
  "drop.pick": "Choose file",
  "drop.replace": "Different file",
  "title.label": "Title",
  "title.placeholder": "Customer portal",
  "title.hint": "Only you see this. The address is generated.",
  "publish.ready": "Publish",
  "publish.noFile": "Publish (no file)",
  "publish.noTitle": "Publish (no title)",

  // form phase — the protect option
  "form.protectLabel": "Protect with a password",
  "form.protectHint": "Applies to the whole artifact, not only its first page.",
  "form.passwordLabel": "Password",
  "form.passwordSuggest": "Suggest",
  "form.passwordHint": "Handout keeps it, so you do not have to write it down.",
  "publish.noPassword": "Publish (no password)",

  // No "uploading phase" strings: no heading (the page's own "New handout"
  // above stays visible) and no "page stays usable" sentence either — with
  // the title field and the publish button hidden during the transfer,
  // nothing on the form is usable, so that sentence would describe nothing.

  // result phase
  "done.lead": "The address is permanent. Whoever has it sees the artifact.",
  "done.leadProtected":
    "The address is permanent. Whoever has it and the password sees the artifact.",
  "done.addressLabel": "Address",
  "done.copy": "Copy address",
  "done.copied": "→ Address copied", // a receipt naming what's on the clipboard, not a bare success word
  "done.copyFailed": "Copying failed. Select the address and copy it by hand.",
  "done.passwordLabel": "Password",
  "done.copyPassword": "Copy password",
  "done.passwordCopied": "→ Password copied",
  "done.passwordCopyFailed":
    "Copying failed. Select the password and copy it by hand.",
  "done.another": "Another handout",

  // viewer's password page
  "viewer.heading": "Enter password",
  "viewer.lead": "This content is protected with a password.",
  "viewer.passwordLabel": "Password",
  "viewer.submit": "Continue",

  // refusals
  "error.tooLargeClient":
    "The file is {size}. Handout does not take more than {limit}.",
  "error.tooLarge": "Handout does not take more than {limit}.",
  "error.unsupported": "Zip, HTML or PDF. Handout does not take other forms.",
  "error.noEntry":
    "There is no entry file in the zip. Expected is an index.html in the zip or in a single folder inside it.",
  "error.unsafeZip": "The zip contains paths outside the archive.",
  "error.noTitle": "A handout needs a title.",
  "error.passwordMissing":
    "The password is missing. Without one the handout is open to anyone who has the address — then turn the option off.",
  "error.passwordTooLong": "A password can be at most {limit} characters.",
  "error.passwordWrong": "The password is not right.",
  "error.unknownAddress": "This address does not exist.",
  "error.signInFailed": "The sign-in did not complete. Start it again.",
  "error.icon": "✕", // aria-hidden next to a refusal; the message already says it in words
};

export function t(key, values = {}) {
  const template = strings[key];
  if (template === undefined) {
    throw new Error(`Unknown string key: ${key}`);
  }
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}
