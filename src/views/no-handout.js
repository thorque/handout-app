import { esc, page } from "./layout.js";
import { strings } from "./strings.js";
import { VIEWER_ASSET_PREFIX } from "../protection.js";

// The one answer a viewer gets from any address under the wildcard host that
// shows nothing — deleted, never issued, or a path that is not in a live
// handout (docs/adr/0023). One sentence and nothing else: two addresses in
// these two states have to be indistinguishable, and anything printed here
// that varies with the address would be the one thing that varies.
//
// An information page, not an error page: it deliberately does not go through
// views/error.js, which keeps the publisher's own refusals and the failed
// sign-in.
//
// `assetPrefix: VIEWER_ASSET_PREFIX` and `clientScript: false` are not
// optional: this page is served under an address host, where `/static/*` is
// routed into serveContent and would answer 404 for every stylesheet.
//
// Every comment in this file stays out of the emitted markup — the viewer
// sees this page and Handout's internals have no business standing in it.
export function renderNoHandoutPage({ config }) {
  const body = `
<h1 class="viewer-heading">${esc(strings["error.unknownAddress"])}</h1>`;

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
