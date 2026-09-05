import { strings } from "./strings.js";

export function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initialsOf(name, email) {
  const source = name || email || "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function header(user) {
  const initials = esc(initialsOf(user?.name, user?.email));
  const name = esc(user?.name || "");
  const email = esc(user?.email || "");
  return `
<header class="header">
  <div class="header-wordmark">
    <span class="header-wordmark-text">handout</span>
    <span class="header-wordmark-bar" aria-hidden="true"></span>
  </div>
  <button
    type="button"
    class="header-profile-button"
    data-profile-toggle
    aria-label="${esc(strings["header.profile"])}"
    aria-expanded="false"
    aria-controls="profile-panel"
  >${initials}</button>
  <div id="profile-panel" class="header-profile-panel" data-profile-panel hidden>
    <div class="header-profile-identity">
      <div class="header-profile-name">${name}</div>
      <div class="header-profile-email">${email}</div>
    </div>
    <div class="header-profile-appearance">
      <div class="header-profile-section-label">${esc(strings["header.appearance"])}</div>
      <div class="header-theme-buttons" role="group">
        <button type="button" class="header-theme-button" data-theme-button="light" aria-pressed="false">
          ${esc(strings["header.themeLight"])}<span class="header-theme-check" data-theme-check></span>
        </button>
        <button type="button" class="header-theme-button" data-theme-button="dark" aria-pressed="false">
          ${esc(strings["header.themeDark"])}<span class="header-theme-check" data-theme-check></span>
        </button>
        <button type="button" class="header-theme-button" data-theme-button="system" aria-pressed="true">
          ${esc(strings["header.themeSystem"])}<span class="header-theme-check" data-theme-check>✓</span>
        </button>
      </div>
    </div>
    <form class="header-signout-form" method="post" action="/auth/logout">
      <button type="submit" class="header-signout-button">${esc(strings["header.signOut"])}</button>
    </form>
  </div>
</header>`;
}

// `config` is accepted (every caller passes it, matching the shared view
// signature) but not read here — nothing in the shell currently varies by
// configuration.
//
// `assetPrefix` lets a caller on the viewer side (content.js, the password
// page) point the stylesheet links at Handout's own reserved prefix instead
// of /static — see docs/adr/0010. `clientScript` and `mainClass` let the
// viewer's password page opt out of the theme switch and the publisher's
// widgets (one feature, and the viewer page has neither) and set its own
// class on <main>.
export function page({
  title,
  user,
  body,
  assetPrefix = "/static",
  clientScript = true,
  mainClass = "page-body",
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${assetPrefix}/tokens.css">
<link rel="stylesheet" href="${assetPrefix}/handout.css">
${
  clientScript
    ? `<script>
  try {
    var t = localStorage.getItem("handout-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
</script>`
    : ""
}
</head>
<body>
${user ? header(user) : ""}
<main class="${mainClass}">
${body}
</main>
${clientScript ? `<script src="${assetPrefix}/handout.js"></script>` : ""}
</body>
</html>`;
}
