import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { normalizeItems, quantity, requestIdentity, documentCode, validateReceipt } from "./document-validation.js";

test("quantity rejects coercion, nonfinite, rounded, negative and overflowing values", () => {
  for (const value of [null, undefined, true, false, [], {}, "", " ", "abc", "1e2", "0x10", "NaN", NaN, Infinity, -1, 0, "1.001", 10000000000]) {
    assert.throws(() => quantity(value), /Số lượng/);
  }
  for (const value of [0.01, "0.10", "12.00", 9999999999.99]) assert.equal(quantity(value), Number(value));
});

test("all lines are validated and dates must be actual calendar dates", () => {
  const item = { productId: 1, quantity: 1, batchCode: " B-1 ", expiryDate: "2028-02-29", location: " A " };
  assert.equal(normalizeItems([item], true)[0].batchCode, "B-1");
  for (const invalid of [[], null, [null], [item, { ...item, quantity: "bad" }], [{ ...item, productId: true }]]) assert.throws(() => normalizeItems(invalid, true));
  for (const expiryDate of ["2027-02-29", "2026-02-30", "2026-13-01", "0001-01-01", "2026-1-1", null]) {
    assert.throws(() => normalizeItems([{ ...item, expiryDate }], true), /Hạn sử dụng/);
  }
  assert.throws(() => normalizeItems([{ ...item, location: " " }], true), /Vị trí/);
});

test("request identity binds one key to the normalized payload and codes resist same-tick collisions", () => {
  const body = { requestKey: randomUUID() };
  assert.equal(requestIdentity(body, { quantity: 1 }).hash, requestIdentity(body, { quantity: 1 }).hash);
  assert.notEqual(requestIdentity(body, { quantity: 1 }).hash, requestIdentity(body, { quantity: 2 }).hash);
  assert.throws(() => requestIdentity({ requestKey: "bad" }, {}), /chống trùng/);
  const codes = Array.from({ length: 10000 }, () => documentCode("PN"));
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every(code => code.length <= 50));
});

test("receipt validation checks matching metadata, expiry, cumulative capacity and product existence", async () => {
  const existing = { id: 1, quantity: "2.00", expiry_date: "2027-01-01", location: "A" };
  const conn = { async query(sql, params) {
    if (sql.includes("FROM products")) return [params[0] === 1 ? [{ id: 1 }] : []];
    if (sql.includes("AS today")) return [[{ today: "2026-11-08" }]];
    if (sql.includes("AS same_code")) return [[{ same_code: params[0].toLowerCase() === params[1].toLowerCase() }]];
    if (sql.includes("FROM batches")) return [[existing]];
    throw new Error(sql);
  } };
  const line = { productId: 1, quantity: 1, batchCode: "B-1", expiryDate: "2027-01-01", location: "A" };
  await validateReceipt(conn, [line, { ...line, batchCode: "b-1" }]);
  await assert.rejects(validateReceipt(conn, [{ ...line, location: "B" }]), /không khớp/);
  await assert.rejects(validateReceipt(conn, [{ ...line, expiryDate: "2026-01-01" }]), /hết hạn/);
  await assert.rejects(validateReceipt(conn, [{ ...line, productId: 2 }]), /không tồn tại/);
  await assert.rejects(validateReceipt(conn, [line, { ...line, quantity: 9999999997 }]), /vượt giới hạn/);
});
