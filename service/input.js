// Parser for Linux input_event records, ES5, no Node APIs (works on a Buffer and a Uint8Array).
//
// This TV is 32-bit ARM, so one record is 16 bytes, little-endian:
//   0..7 timestamp (seconds, microseconds), 8..9 type, 10..11 code, 12..15 value.
var RECORD_SIZE = 16;
var EV_KEY = 1;
var VALUE_RELEASE = 0;
var VALUE_PRESS = 1;
// Key code of HOME on the Magic Remote, measured on the tested remote; see docs/guide.md, "HOME key code", to measure yours.
var HOME_KEY_CODE = 773;

// Returns one {type, code, value} entry per complete record; a trailing partial record is ignored.
function parseInputEvents(buffer) {
  var events = [];
  for (var offset = 0; offset + RECORD_SIZE <= buffer.length; offset += RECORD_SIZE) {
    events.push({
      type: buffer[offset + 8] | (buffer[offset + 9] << 8),
      code: buffer[offset + 10] | (buffer[offset + 11] << 8),
      // value is signed in the kernel struct; relative axes can be negative
      value: (buffer[offset + 12] | (buffer[offset + 13] << 8) | (buffer[offset + 14] << 16) | (buffer[offset + 15] << 24)),
    });
  }
  return events;
}

module.exports = {
  RECORD_SIZE: RECORD_SIZE,
  EV_KEY: EV_KEY,
  VALUE_PRESS: VALUE_PRESS,
  VALUE_RELEASE: VALUE_RELEASE,
  HOME_KEY_CODE: HOME_KEY_CODE,
  parseInputEvents: parseInputEvents,
};
