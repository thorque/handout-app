import { esc } from "./layout.js";
import { strings } from "./strings.js";

// A plain page for the cases that are not full publisher screens: an unknown
// address, and a failed sign-in. No header — there is no signed-in publisher
// context here. The refused sign-in is the one case that offers a way out
// (`signOut`), because the person is signed in at the provider and has to be
// able to leave.
export function renderError({
  message,
  assetPrefix = "/static",
  signOut = false,
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handout</title>
<link rel="stylesheet" href="${assetPrefix}/tokens.css">
<link rel="stylesheet" href="${assetPrefix}/handout.css">
</head>
<body>
<main style="max-width:var(--measure);margin:96px auto;padding:0 5%;text-align:center">
<h1 style="font-size:var(--text-2xl);font-weight:var(--weight-semibold)">${esc(message)}</h1>${
    signOut
      ? `
<form class="no-access-signout-form" method="post" action="/auth/logout">
<button type="submit" class="no-access-signout-button">${esc(strings["noAccess.signOut"])}</button>
</form>`
      : ""
  }
</main>
</body>
</html>`;
}
