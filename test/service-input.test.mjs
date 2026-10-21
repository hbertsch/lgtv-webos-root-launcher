import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseInputEvents, HOME_KEY_CODE, EV_KEY, VALUE_PRESS, VALUE_RELEASE, RECORD_SIZE } = require("../service/input.js");

const EV_SYN = 0;

function inputRecord(type, code, value) {
  const record = Buffer.alloc(RECORD_SIZE);
  record.writeUInt32LE(1000, 0); // seconds
  record.writeUInt32LE(500, 4); // microseconds
  record.writeUInt16LE(type, 8);
  record.writeUInt16LE(code, 10);
  record.writeInt32LE(value, 12);
  return record;
}

test("a HOME press is reported with the HOME key code", () => {
  const events = parseInputEvents(inputRecord(EV_KEY, HOME_KEY_CODE, VALUE_PRESS));
  assert.deepEqual(events, [{ type: EV_KEY, code: HOME_KEY_CODE, value: VALUE_PRESS }]);
});

test("a HOME release has value 0", () => {
  const events = parseInputEvents(inputRecord(EV_KEY, HOME_KEY_CODE, VALUE_RELEASE));
  assert.deepEqual(events, [{ type: EV_KEY, code: HOME_KEY_CODE, value: VALUE_RELEASE }]);
});

test("a non-key event keeps its own type", () => {
  const events = parseInputEvents(inputRecord(EV_SYN, 0, 0));
  assert.deepEqual(events, [{ type: EV_SYN, code: 0, value: 0 }]);
});

test("a negative value stays negative", () => {
  const events = parseInputEvents(inputRecord(2, 0, -5));
  assert.equal(events[0].value, -5);
});

test("a partial trailing record is ignored", () => {
  const buffer = Buffer.concat([inputRecord(EV_KEY, HOME_KEY_CODE, VALUE_PRESS), inputRecord(EV_KEY, 1, 1).subarray(0, 10)]);
  assert.equal(parseInputEvents(buffer).length, 1);
  assert.deepEqual(parseInputEvents(Buffer.alloc(RECORD_SIZE - 1)), []);
});

test("several records in one buffer are returned in order", () => {
  const buffer = Buffer.concat([
    inputRecord(EV_KEY, HOME_KEY_CODE, VALUE_PRESS),
    inputRecord(EV_SYN, 0, 0),
    inputRecord(EV_KEY, HOME_KEY_CODE, VALUE_RELEASE),
  ]);
  assert.deepEqual(parseInputEvents(buffer), [
    { type: EV_KEY, code: HOME_KEY_CODE, value: VALUE_PRESS },
    { type: EV_SYN, code: 0, value: 0 },
    { type: EV_KEY, code: HOME_KEY_CODE, value: VALUE_RELEASE },
  ]);
});
