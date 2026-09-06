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
  // form.cancel, upload.cancel, rejected.cancel and entry.cancel are all
  // "Cancel" — one value, four keys, on purpose and consistent with the
  // rest of this module: the prefix names the screen throughout (form.,
  // drop., entry., done., dash., row.), so a later wording change on one
  // screen must not silently move the others.
  "form.cancel": "Cancel",
  "upload.cancel": "Cancel",

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
  "done.toDashboard": "To the dashboard",
  "done.copyBoth": "Copy address and password",
  "done.bothCopied": "→ Address and password copied",
  "done.copyBothFailed":
    "Copying failed. Select the address and the password and copy them by hand.",

  // dashboard phase. The row.* labels repeat the done.* values on purpose:
  // the key prefix names the screen throughout this module (form., drop.,
  // entry., done., viewer.), and the dashboard is a screen of its own. Only
  // the message text is shared, and it is shared through src/message.js, not
  // through a string key (docs/adr/0013).
  "dash.heading": "My handouts",
  "dash.countNone": "No handouts.",
  "dash.countOne": "One handout reachable.",
  "dash.countMany": "{count} handouts reachable.",
  "dash.new": "New handout",
  "dash.empty": "No handout published yet.",

  "row.protected": "Password",
  "row.open": "Freely reachable",
  "row.lastState": "Last state",
  "row.menu": "More actions",
  "row.copyAddress": "Copy address",
  "row.addressCopied": "→ Address copied",
  "row.copyAddressFailed":
    "Copying failed. Select the address and copy it by hand.",
  "row.copyPassword": "Copy password",
  "row.passwordCopied": "→ Password copied",
  // Shorter than done.passwordCopyFailed on purpose: the password is not on
  // screen in a row, so "select it by hand" would name a way out that does
  // not exist.
  "row.copyPasswordFailed": "Copying failed.",
  "row.copyBoth": "Copy address and password",
  "row.bothCopied": "→ Address and password copied",
  "row.copyBothFailed": "Copying failed.",
  "row.uploadState": "Upload a new state",
  // row.* repeats several entry.* values on purpose — the module's own rule
  // above (the key prefix names the screen throughout) applies here too: the
  // row panel is its own screen, so a later wording change to the
  // entry-choice screen must not silently move this one's.
  "row.changeEntry": "Change the entry page",
  "row.entryLegend": "Which file is the entry page?",
  "row.entryDescription":
    "Currently: {entry}. Paths are relative to the root of the zip.",
  "row.entryDescriptionNone": "Paths are relative to the root of the zip.",
  "row.entryFilterLabel": "Filter by path",
  "row.entryFilterPlaceholder": "chapter",
  "row.entryFilterCountAll": "{total} HTML files",
  "row.entryFilterCountSome": "{shown} of {total} HTML files",
  "row.entryFilterCountSomePinned":
    "{shown} of {total} HTML files, plus the selected one",
  "row.entryNoMatch": "No path contains this text.",
  "row.entryNote":
    "The address and the password stay the same. Nothing is uploaded, and the time still names the last state.",
  "row.entrySave": "Save",
  "row.entrySaveUnchanged": "Save (no other page chosen)",
  "row.entryCancel": "Cancel",
  "stamp.utc": "{stamp} UTC",

  // the message that goes into a mail or a chat — src/message.js composes it,
  // the result page and the dashboard's row menu both hand out that one form
  "message.addressLabel": "Handout:",
  "message.passwordLabel": "Password:",

  // viewer's password page
  "viewer.heading": "Enter password",
  "viewer.lead": "This content is protected with a password.",
  "viewer.passwordLabel": "Password",
  "viewer.submit": "Continue",

  // entry-choice phase (the zip holds several HTML files, none of them
  // index.html) — docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md
  "entry.lead": "The zip has arrived. One detail is still missing.",
  "entry.summaryProtected": "with a password",
  "entry.summaryOpen": "no password",
  "entry.chosen": "Entry page:",
  "entry.legend": "Which file is the entry page?",
  "entry.hint":
    "The zip contains several HTML files and no index.html. Paths are relative to the root of the zip.",
  "entry.filterLabel": "Filter by path",
  "entry.filterPlaceholder": "chapter",
  "entry.filterCountAll": "{total} HTML files",
  "entry.filterCountSome": "{shown} of {total} HTML files",
  "entry.filterCountSomePinned":
    "{shown} of {total} HTML files, plus the selected one",
  "entry.noMatch": "No path contains this text.",
  "entry.cancel": "Cancel",
  "publish.noEntry": "Publish (no entry page)",

  // rejected phase — a zip with no HTML file at all
  "rejected.lead": "The zip has arrived but cannot be published.",
  "rejected.chooseAnother": "Choose a different file",
  "rejected.cancel": "Cancel",

  // refusals
  "error.tooLargeClient":
    "The file is {size}. Handout does not take more than {limit}.",
  "error.tooLarge": "Handout does not take more than {limit}.",
  "error.unsupported": "Zip, HTML or PDF. Handout does not take other forms.",
  "error.noHtml":
    "The zip contains no HTML file. Expected is a zip with at least one HTML file, a single HTML file, or a PDF.",
  "error.entryNotChosen": "Choose the entry page.",
  "error.entryNotInZip": "That file is not one of the zip's HTML files.",
  "error.uploadGone":
    "The upload is no longer available. Upload the file again.",
  "error.unsafeZip": "The zip contains paths outside the archive.",
  "error.noTitle": "A handout needs a title.",
  "error.passwordMissing":
    "The password is missing. Without one the handout is open to anyone who has the address — then turn the option off.",
  "error.passwordTooLong": "A password can be at most {limit} characters.",
  "error.passwordWrong": "The password is not right.",
  "error.unknownAddress": "This address does not exist.",
  "error.entryStateMoved":
    "This handout has been updated in the meantime. Reload the page and choose again.",
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
