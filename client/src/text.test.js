import test from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "./text.js";

test("repairs the broken units shown in Products and Batches", () => {
  assert.equal(cleanText("h\u00e1\u00bb\u2122p"), "hộp");
  assert.equal(cleanText("cu\u00e1\u00bb\u2122n"), "cuộn");
  assert.equal(cleanText("h\u00e1\u00bb\u0099p"), "hộp");
});

test("preserves correct units and mixed Vietnamese text", () => {
  for (const unit of ["hộp", "cuộn", "ram", "chai", "cái", "bộ", "túi", "kg", "m²", "lít"]) {
    assert.equal(cleanText(unit), unit);
  }
  assert.equal(cleanText("Đơn vị: h\u00e1\u00bb\u2122p"), "Đơn vị: hộp");
  assert.equal(cleanText("  ho\u0323\u0302p  "), "hộp");
});

test("handles HTML entities, repeated encoding and empty values", () => {
  assert.equal(cleanText("h&#x1ED9;p"), "hộp");
  assert.equal(cleanText("b&amp;#7897;"), "bộ");
  assert.equal(cleanText("h&#225;&#187;&#8482;p"), "hộp");
  const doubleEncoded = Buffer.from("h\u00e1\u00bb\u2122p", "utf8").toString("latin1");
  assert.equal(cleanText(doubleEncoded), "hộp");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText("&#xD800;"), "&#xD800;");
  assert.equal(cleanText("&#x110000;"), "&#x110000;");
  assert.equal(cleanText("&lt;script&gt;"), "<script>");
});
