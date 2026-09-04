import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestServer } from "./helpers/app.js";
import { strings } from "../src/views/strings.js";
import { contentTypeFor } from "../src/mime.js";

// Finds the class of the innermost classed element that actually wraps
// `marker` (a data- attribute, say) — not just an element that carries the
// class somewhere on the page. Written to catch exactly the drop-empty /
// drop-filled defect: an element the markup relies on for behaviour but
// that has no class, so no rule in the stylesheet ever reaches it, even
// though a sibling or ancestor happens to have one.
function classOfElementWrapping(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  const openTagPattern = /<div class="([^"]+)"[^>]*>/g;
  let bestClass = null;
  let bestOpenEnd = -1;
  let match;
  while ((match = openTagPattern.exec(html))) {
    const openEnd = match.index + match[0].length;
    // Skip a div whose own opening tag is where the marker lives (the
    // element carrying the marker itself, not one wrapping it) and
    // anything starting at or after the marker.
    if (openEnd > markerIndex) break;

    // Find this div's matching close tag by depth-counting nested <div>s.
    const tagPattern = /<div\b[^>]*>|<\/div>/g;
    tagPattern.lastIndex = openEnd;
    let depth = 1;
    let closeStart = -1;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(html))) {
      if (tagMatch[0].startsWith("</")) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        closeStart = tagMatch.index;
        break;
      }
    }

    if (closeStart !== -1 && markerIndex < closeStart && openEnd > bestOpenEnd) {
      bestClass = match[1];
      bestOpenEnd = openEnd;
    }
  }
  return bestClass;
}

function extractLocalReferences(html) {
  const refs = new Set();
  const attrPattern = /(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = attrPattern.exec(html))) {
    const value = match[1];
    if (value.startsWith("/") && !value.startsWith("//")) {
      refs.add(value);
    }
  }
  return [...refs];
}

test("GET / follows every local reference the page carries", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    const refs = extractLocalReferences(html);
    assert.ok(refs.length > 0, "expected at least one local reference");

    for (const ref of refs) {
      const refRes = await fetch(`${t.baseUrl}${ref}`, { headers: { cookie } });
      assert.strictEqual(refRes.status, 200, `expected 200 for ${ref}`);
      const body = await refRes.arrayBuffer();
      assert.ok(body.byteLength > 0, `expected non-empty body for ${ref}`);
      const contentType = refRes.headers.get("content-type");
      assert.strictEqual(contentType, contentTypeFor(ref), `content type for ${ref}`);
    }

    assert.ok(html.includes(`data-pick>${strings["drop.pick"]}</button>`) || html.includes(`>${strings["drop.pick"]}<`));
  } finally {
    await t.close();
  }
});

test("GET / carries a real focusable choose-file button and a hidden file input", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.match(html, /<button type="button" class="drop-pick-button" data-pick>/);
    assert.match(html, /<input[^>]*type="file"[^>]*tabindex="-1"[^>]*aria-hidden="true"/);

    const cssRes = await fetch(`${t.baseUrl}/static/handout.css`, { headers: { cookie } });
    const css = await cssRes.text();
    assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
  } finally {
    await t.close();
  }
});

test("GET / builds the upload ceiling from configuration, not a template literal", async () => {
  const t = await buildTestServer({ maxUploadBytes: 1048576 });
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();
    assert.ok(html.includes("up to 1 MB"), "expected the literal 'up to 1 MB' in the page");
    assert.ok(
      html.includes('data-max-upload-bytes="1048576"'),
      "expected the literal data-max-upload-bytes attribute",
    );
  } finally {
    await t.close();
  }
});

test("the drop area's empty and filled wrappers are classed, and space their own children", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // .drop-area's own gap only spaces its *direct* children — never
    // anything nested inside one of them — so each of these wrappers has to
    // carry its own class and its own display: flex/gap, or the headline,
    // hint and button (or name, size and button) stack with zero spacing.
    const emptyClass = classOfElementWrapping(html, "data-drop-headline");
    assert.ok(emptyClass, "expected the element wrapping [data-drop-headline] to carry a class");
    const filledClass = classOfElementWrapping(html, "data-filled-name");
    assert.ok(filledClass, "expected the element wrapping [data-filled-name] to carry a class");

    const cssRes = await fetch(`${t.baseUrl}/static/handout.css`, { headers: { cookie } });
    const css = await cssRes.text();

    const emptyRule = new RegExp(`\\.${emptyClass}\\s*\\{[^}]*\\}`).exec(css);
    assert.ok(emptyRule, `expected a .${emptyClass} rule`);
    assert.match(emptyRule[0], /display:\s*flex/);
    assert.match(emptyRule[0], /gap:\s*var\(--space-3\)/);

    const filledRule = new RegExp(`\\.${filledClass}\\s*\\{[^}]*\\}`).exec(css);
    assert.ok(filledRule, `expected a .${filledClass} rule`);
    assert.match(filledRule[0], /display:\s*flex/);
    assert.match(filledRule[0], /gap:\s*var\(--space-2\)/);
  } finally {
    await t.close();
  }
});

// Extracts every element in html that carries a literal `hidden` boolean
// attribute (never `aria-hidden`, which ends in `="true"` rather than a
// bare word boundary), with the class(es) on that same tag.
function findHiddenElements(html) {
  const found = [];
  const tagPattern = /<(\w+)([^>]*)>/g;
  let match;
  while ((match = tagPattern.exec(html))) {
    const [, tag, attrs] = match;
    if (!/(?:^|\s)hidden(?:$|\s|>)/.test(attrs)) continue;
    const classMatch = /class="([^"]*)"/.exec(attrs);
    found.push({ tag, classes: classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [] });
  }
  return found;
}

test("every element toggled with the hidden attribute actually stays hidden", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // The four elements toggled with `hidden` on this page today:
    // [data-drop-filled], [data-drop-message], [data-upload-box] and
    // [data-profile-panel]. Enumerated from the rendered markup rather than
    // hard-coded, so this still holds when a fifth is added.
    const hiddenElements = findHiddenElements(html);
    assert.ok(
      hiddenElements.length >= 4,
      `expected at least 4 elements carrying the hidden attribute, found ${hiddenElements.length}`,
    );

    const cssRes = await fetch(`${t.baseUrl}/static/handout.css`, { headers: { cookie } });
    const css = await cssRes.text();

    const globalGuard = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.exec(css);
    assert.ok(globalGuard, "expected a global [hidden] { display: none !important; } rule");

    // Belt and braces: if the global guard were ever removed, an element
    // whose own class also sets `display` would silently become visible
    // (an author rule outranks the browser's own [hidden]{display:none}).
    // This is the exact shape of the regression the global rule fixed.
    for (const el of hiddenElements) {
      for (const cls of el.classes) {
        const classRule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css);
        if (!classRule) continue;
        const setsDisplay = /display:/.test(classRule[0]);
        assert.ok(
          !setsDisplay || globalGuard,
          `<${el.tag} class="${cls}"> is toggled with hidden and its class sets display, with no global [hidden] guard to override it`,
        );
      }
    }
  } finally {
    await t.close();
  }
});

// The actual show/hide swap during an in-flight upload is client-side
// behaviour this test harness cannot drive (no browser, no real XHR). What
// is pinned instead is the static shape that swap depends on: the drop
// area's slot has exactly two candidates, adjacent, exactly one of them
// starting visible; the three elements the script hides together during a
// transfer (the drop area, the title field block, the Publish button) all
// start visible and carry the exact data- markers the script toggles, so a
// renamed marker breaks this test rather than silently breaking the
// behaviour; and the block that takes over the slot has no heading of its
// own, since the page's own heading and lead stay on screen throughout.
test("the drop area, the title field and the Publish button are exactly what an upload hides, and all start visible", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // Siblings in the same slot: nothing but the drop area's own closing
    // </div> and a comment sit between the file input (the drop area's last
    // child) and the upload-phase wrapper that follows it — not the title
    // field or the Publish button in between.
    const fileInputEnd = html.indexOf(">", html.indexOf("data-file-input")) + 1;
    const uploadPhaseStart = html.indexOf('<div class="upload-phase"');
    const between = html.slice(fileInputEnd, uploadPhaseStart).replace(/<!--[\s\S]*?-->/g, "");
    assert.match(
      between.trim(),
      /^<\/div>$/,
      `expected only the drop area's own closing tag between it and the upload-phase wrapper, got: ${JSON.stringify(between)}`,
    );

    // Exactly one candidate for the slot starts hidden: the drop area is
    // the visible default, the upload phase carries `hidden`.
    const dropAreaTag = /<div\s+class="drop-area[^"]*"[^>]*>/.exec(html)[0];
    const uploadPhaseTag = /<div\s+class="upload-phase"[^>]*>/.exec(html)[0];
    assert.doesNotMatch(dropAreaTag, /\bhidden\b/);
    assert.match(uploadPhaseTag, /\bhidden\b/);

    // No heading inside the upload block: the page's own "New handout" and
    // lead above it stay visible throughout, so this needs no context of
    // its own.
    const uploadPhaseBlock = /<div\s+class="upload-phase"[^>]*>[\s\S]*?<div\s+class="field"/.exec(html)[0];
    assert.doesNotMatch(uploadPhaseBlock, /<h1/);

    // The other two elements an upload hides — the title field block and
    // the Publish button — both start visible (un-hidden) and carry the
    // markers finishUpload() and the submit handler actually toggle.
    const fieldTag = /<div\s+class="field"[^>]*>/.exec(html)[0];
    assert.match(fieldTag, /data-field\b/);
    assert.doesNotMatch(fieldTag, /\bhidden\b/);

    const publishButtonTag = /<button[^>]*data-publish-button[^>]*>/.exec(html)[0];
    assert.doesNotMatch(publishButtonTag, /\bhidden\b/);
  } finally {
    await t.close();
  }
});

test("a refusal is styled with the danger colour, not conveyed by colour alone", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const cssRes = await fetch(`${t.baseUrl}/static/handout.css`, { headers: { cookie } });
    const css = await cssRes.text();

    // The drop-message is the primary feedback on a large surface, so it
    // takes the visible-error size (16px, var(--text-md)) and semibold —
    // the field-hint size (13px) is reserved for the field-level slot below.
    const messageRule = /\.drop-message\s*\{[^}]*\}/.exec(css);
    assert.ok(messageRule, "expected a .drop-message rule");
    assert.match(messageRule[0], /color:\s*var\(--danger-ink\)/);
    assert.match(messageRule[0], /font-size:\s*var\(--text-md\)/);
    assert.match(messageRule[0], /font-weight:\s*var\(--weight-semibold\)/);

    // The aria-hidden icon plus the wording carry the refusal without
    // relying on the colour: the icon needs its own weight, independent of
    // whatever .drop-message itself sets.
    assert.match(css, /\.drop-message-icon\s*\{[^}]*font-weight:\s*600/);

    // The drop area itself is framed when the refusal is about the file —
    // mirroring .drop-area.dragging in the opposite key: still dashed, plus
    // an inset shadow and the danger-quiet background.
    const dropAreaErrorRule = /\.drop-area\.error\s*\{[^}]*\}/.exec(css);
    assert.ok(dropAreaErrorRule, "expected a .drop-area.error rule");
    assert.match(dropAreaErrorRule[0], /border:[^;]*dashed[^;]*var\(--danger\)/);
    assert.match(dropAreaErrorRule[0], /box-shadow:\s*inset[^;]*var\(--danger\)/);
    assert.match(dropAreaErrorRule[0], /background:\s*var\(--danger-quiet\)/);

    // The field-level treatment the design system uses for an invalid
    // input (the missing-title case): a danger-coloured border *and* an
    // inset shadow, layered over the plain text-field rule rather than
    // replacing it. Its message stays in the 13px hint slot.
    const fieldErrorRule = /[^{}]*\.field-input-error\s*\{[^}]*\}/.exec(css);
    assert.ok(fieldErrorRule, "expected a rule targeting .field-input-error");
    assert.match(fieldErrorRule[0], /border:[^;]*var\(--danger\)/);
    assert.match(fieldErrorRule[0], /box-shadow:\s*inset[^;]*var\(--danger\)/);

    const fieldHintErrorRule = /\.field-hint-error\s*\{[^}]*\}/.exec(css);
    assert.ok(fieldHintErrorRule, "expected a .field-hint-error rule");
    assert.match(fieldHintErrorRule[0], /color:\s*var\(--danger-ink\)/);
    assert.doesNotMatch(fieldHintErrorRule[0], /font-size/, "the field-level message keeps the 13px hint size, not its own");
  } finally {
    await t.close();
  }
});

test("the profile toggle and panel share the positioned header row, not the button", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // Per the design system, there is no wrapper: the panel is a direct
    // child of the header row itself, which is what carries
    // `position: relative`. A relative button does nothing for an
    // absolutely-positioned sibling.
    const headerMatch = /<header class="header">([\s\S]*?)<\/header>/.exec(html);
    assert.ok(headerMatch, 'expected a <header class="header"> element');
    const headerRow = headerMatch[1];
    assert.match(headerRow, /data-profile-toggle/);
    assert.match(headerRow, /data-profile-panel/);

    const cssRes = await fetch(`${t.baseUrl}/static/handout.css`, { headers: { cookie } });
    const css = await cssRes.text();
    const headerRule = /\.header\s*\{[^}]*\}/.exec(css);
    assert.ok(headerRule, "expected a .header rule");
    assert.match(headerRule[0], /position:\s*relative/);
    // Not on the button: a second `position: relative` there would still
    // establish a containing block for the panel by accident and hide the
    // regression this test exists to catch.
    const buttonRule = /\.header-profile-button\s*\{[^}]*\}/.exec(css);
    assert.ok(buttonRule);
    assert.doesNotMatch(buttonRule[0], /position:\s*relative/);
  } finally {
    await t.close();
  }
});

test("unauthenticated GET / redirects to /auth/login", async () => {
  const t = await buildTestServer();
  try {
    const res = await fetch(`${t.baseUrl}/`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get("location"), /^\/auth\/login/);
  } finally {
    await t.close();
  }
});
