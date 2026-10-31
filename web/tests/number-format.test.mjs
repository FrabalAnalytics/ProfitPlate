import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAmount,
  formatInventoryNumber,
  formatPercentage,
  formatCurrency,
  formatDecimalInput,
} from "../lib/inventory-format.ts";

test("money and percentages round to two places while quantities retain three", () => {
  assert.equal(formatAmount("33.33333333"), "33.33");
  assert.equal(formatAmount("166.66666667"), "166.67");
  assert.equal(formatPercentage("83.33333333"), "83.33%");
  assert.equal(formatInventoryNumber("2.000000"), "2.000");
  assert.equal(formatInventoryNumber("1.234567"), "1.235");
  assert.equal(formatAmount("9.995"), "10.00");
  assert.equal(formatAmount("-0.004"), "0.00");
  assert.equal(formatAmount("-0.005"), "-0.01");
});

test("large money amounts retain exact decimal digits and missing amounts stay unknown", () => {
  assert.equal(formatAmount("9999999999999999.995"), "10000000000000000.00");
  assert.equal(
    formatCurrency("9999999999999999.995"),
    "₦10,000,000,000,000,000.00",
  );
  assert.equal(formatCurrency("-1234.567"), "-₦1,234.57");
  assert.equal(formatAmount(null), "Unavailable");
  assert.equal(formatPercentage(undefined), "Unavailable");
  assert.equal(formatAmount("0"), "0.00");
  assert.equal(formatPercentage("0"), "0.00%");
});

test("editable defaults remove padding without rounding meaningful stored digits", () => {
  assert.equal(formatDecimalInput("100.00000000", 2), "100.00");
  assert.equal(formatDecimalInput("33.33333333", 2), "33.33333333");
  assert.equal(formatDecimalInput("2.000000"), "2.000");
  assert.equal(formatDecimalInput("1.234567"), "1.234567");
  assert.equal(formatDecimalInput(""), "");
});
