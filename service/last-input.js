// Last-input override for bootd, ES5. Used by service.js (and by the takeover module).
//
// bootd opens the app named in physicalLastSourceAppId of this file at power-on, and starts
// the input named in physicalLastSourceId (DTV would tune the TV behind the launcher). The
// external-input manager rewrites both at every input change, so the service writes the
// launcher and an unused HDMI input into them at power-off (and at start). The original file
// is kept once.
var fs = require("fs");

var LAST_INPUT_SOURCE_ID = "HDMI_1";

// options: { file, backupFile, launcherAppFile, appId, log }
function createLastInput(options) {
  var tempFile = options.file + ".launcher.tmp";

  function writeLastInput(content) {
    fs.writeFileSync(tempFile, content);
    fs.renameSync(tempFile, options.file);
  }

  function pointAtLauncher(reason) {
    try {
      if (!fs.existsSync(options.launcherAppFile)) {
        options.log("last input: launcher not installed, file left alone");
        return;
      }
      var rawContent = fs.readFileSync(options.file, "utf8");
      var lastInput = JSON.parse(rawContent);
      if (lastInput.physicalLastSourceAppId === options.appId && lastInput.physicalLastSourceId === LAST_INPUT_SOURCE_ID) {
        return;
      }
      if (!fs.existsSync(options.backupFile)) {
        fs.writeFileSync(options.backupFile, rawContent);
      }
      lastInput.physicalLastSourceAppId = options.appId;
      lastInput.physicalLastSourceId = LAST_INPUT_SOURCE_ID;
      writeLastInput(JSON.stringify(lastInput));
      options.log("last input (" + reason + "): was " + rawContent + ", now " + JSON.stringify(lastInput));
    } catch (error) {
      options.log("last input (" + reason + ") failed: " + error);
    }
  }

  // Puts the original last-input app and source back into the file as it is now, if the file
  // still points at the launcher.
  function restoreOriginal() {
    try {
      if (!fs.existsSync(options.backupFile)) {
        options.log("last input: no original saved, file left alone");
        return;
      }
      var currentContent = fs.readFileSync(options.file, "utf8");
      var current = JSON.parse(currentContent);
      if (current.physicalLastSourceAppId !== options.appId) {
        return;
      }
      var original = JSON.parse(fs.readFileSync(options.backupFile, "utf8"));
      current.physicalLastSourceAppId = original.physicalLastSourceAppId;
      current.physicalLastSourceId = original.physicalLastSourceId;
      var restoredContent = JSON.stringify(current);
      writeLastInput(restoredContent);
      options.log("last input restored: was " + currentContent + ", now " + restoredContent);
    } catch (error) {
      options.log("last input restore failed: " + error);
    }
  }

  return { pointAtLauncher: pointAtLauncher, restoreOriginal: restoreOriginal };
}

module.exports = { createLastInput: createLastInput };
