import { test } from "node:test";
import assert from "node:assert/strict";
import { messageText } from "../src/message.js";
import { strings } from "../src/views/strings.js";

test("the two labels are the design's settled wording", () => {
  assert.strictEqual(strings["message.addressLabel"], "Handout:");
  assert.strictEqual(strings["message.passwordLabel"], "Password:");
});

test("messageText joins address and password, address first, one line break, no trailing newline", () => {
  const text = messageText(
    "http://abcdefghij.example.test",
    "barn-leaf-dove-945",
  );
  assert.strictEqual(
    text,
    `${strings["message.addressLabel"]} http://abcdefghij.example.test\n${strings["message.passwordLabel"]} barn-leaf-dove-945`,
  );
  assert.strictEqual((text.match(/\n/g) || []).length, 1);
  assert.ok(!text.endsWith("\n"));
});

test("messageText is null without a password, in every shape a missing password arrives in", () => {
  assert.strictEqual(messageText("http://abcdefghij.example.test", null), null);
  assert.strictEqual(messageText("http://abcdefghij.example.test", ""), null);
  assert.strictEqual(
    messageText("http://abcdefghij.example.test", undefined),
    null,
  );
});
