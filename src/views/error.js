import { esc } from "./layout.js";

// A plain page for the cases that are not full publisher screens: an unknown
// address, and a failed sign-in. No header — there is no signed-in publisher
// context here.
export function renderError({ message }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handout</title>
<link rel="stylesheet" href="/static/tokens.css">
<link rel="stylesheet" href="/static/handout.css">
</head>
<body>
<main style="max-width:var(--measure);margin:96px auto;padding:0 5%;text-align:center">
<h1 style="font-size:var(--text-2xl);font-weight:var(--weight-semibold)">${esc(message)}</h1>
</main>
</body>
</html>`;
}
