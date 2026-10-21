var KEY_ENTER = 13;
var KEY_LEFT = 37;
var KEY_UP = 38;
var KEY_RIGHT = 39;
var KEY_DOWN = 40;
var KEY_BACK = 461;

var GRID_COLUMNS = 3; // keep in sync with grid-template-columns in style.css
var MAX_STATUS_LINES = 2;
var DARK_TEXT_MIN_LUMINANCE = 0.4;
var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
var LAUNCH_URI = "luna://com.webos.applicationManager/launch";
var SERVICE_LAUNCH_URI = "luna://lgtv.blueprint.launcher.service/launch";
var SERVICE_TIMEOUT_MS = 3000;
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

var grid = document.getElementById("grid");
var toolbar = document.getElementById("toolbar");
var clock = document.getElementById("clock");
var greeting = document.getElementById("greeting");
var date = document.getElementById("date");
var statusBox = document.getElementById("status");
var statusLines = [];
var tiles = [];
var toolbarButtons = [];

function showStatus(text, isError) {
  statusLines.push({ text: text, isError: isError });
  statusLines = statusLines.slice(-MAX_STATUS_LINES);
  statusBox.innerHTML = "";
  statusLines.forEach(function (line) {
    var element = document.createElement("div");
    element.textContent = line.text;
    if (line.isError) {
      element.className = "error";
    }
    statusBox.appendChild(element);
  });
}

function callLuna(uri, payload, onResponse) {
  var bridge = new window.PalmServiceBridge();
  bridge.onservicecallback = function (message) {
    onResponse(JSON.parse(message));
  };
  bridge.call(uri, JSON.stringify(payload));
}

function launchDirect(entry) {
  callLuna(LAUNCH_URI, { id: entry.appId, params: {} }, function (response) {
    if (response.returnValue === false) {
      showStatus(entry.title + ": " + response.errorText + " (code " + response.errorCode + ")", true);
    } else {
      showStatus("launched " + entry.title);
    }
  });
}

// The service launches privileged apps; if it is missing or silent, launch directly.
function launch(entry) {
  if (typeof window.PalmServiceBridge !== "function") {
    showStatus("[browser mode] launch " + entry.title + " (" + entry.appId + ")");
    return;
  }

  var answered = false;
  var timeoutId = setTimeout(function () {
    if (!answered) {
      answered = true;
      showStatus("service did not answer, launching " + entry.title + " directly", true);
      launchDirect(entry);
    }
  }, SERVICE_TIMEOUT_MS);

  callLuna(SERVICE_LAUNCH_URI, { id: entry.appId, params: {} }, function (response) {
    if (answered) {
      return;
    }
    answered = true;
    clearTimeout(timeoutId);
    if (response.returnValue === false) {
      showStatus("service: " + response.errorText + ", launching " + entry.title + " directly", true);
      launchDirect(entry);
    } else {
      showStatus("launched " + entry.title);
    }
  });
}

function focusAt(elements, index) {
  if (index >= 0 && index < elements.length) {
    elements[index].focus({ preventScroll: true });
  }
}

function centreX(element) {
  var box = element.getBoundingClientRect();
  return box.left + box.width / 2;
}

function focusClosest(elements, reference) {
  var referenceX = centreX(reference);
  var closest = elements[0];
  elements.forEach(function (element) {
    if (Math.abs(centreX(element) - referenceX) < Math.abs(centreX(closest) - referenceX)) {
      closest = element;
    }
  });
  closest.focus({ preventScroll: true });
}

function onKeyDown(event) {
  var focused = document.activeElement;
  var tileIndex = tiles.indexOf(focused);
  var buttonIndex = toolbarButtons.indexOf(focused);

  switch (event.keyCode) {
    case KEY_LEFT:
      if (tileIndex >= 0 && tileIndex % GRID_COLUMNS > 0) {
        focusAt(tiles, tileIndex - 1);
      } else if (buttonIndex >= 0) {
        focusAt(toolbarButtons, buttonIndex - 1);
      }
      break;
    case KEY_RIGHT:
      if (tileIndex >= 0 && tileIndex % GRID_COLUMNS < GRID_COLUMNS - 1) {
        focusAt(tiles, tileIndex + 1);
      } else if (buttonIndex >= 0) {
        focusAt(toolbarButtons, buttonIndex + 1);
      }
      break;
    case KEY_UP:
      if (tileIndex >= GRID_COLUMNS) {
        focusAt(tiles, tileIndex - GRID_COLUMNS);
      } else if (tileIndex >= 0 && toolbarButtons.length > 0) {
        focusClosest(toolbarButtons, focused);
      }
      break;
    case KEY_DOWN:
      if (tileIndex >= 0) {
        focusAt(tiles, tileIndex + GRID_COLUMNS);
      } else if (buttonIndex >= 0 && tiles.length > 0) {
        focusClosest(tiles.slice(0, GRID_COLUMNS), focused);
      }
      break;
    case KEY_ENTER:
      if (focused.entry) {
        launch(focused.entry);
      }
      break;
    case KEY_BACK:
      break;
    default:
      return;
  }
  event.preventDefault();
}

function channelLuminance(hexPair) {
  var value = parseInt(hexPair, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function isBright(hexColor) {
  var luminance = 0.2126 * channelLuminance(hexColor.substr(1, 2)) +
    0.7152 * channelLuminance(hexColor.substr(3, 2)) +
    0.0722 * channelLuminance(hexColor.substr(5, 2));
  return luminance > DARK_TEXT_MIN_LUMINANCE;
}

// The logo comes from the sprite in logos.svg, otherwise the icon file, otherwise the full app name.
function createMark(entry, className) {
  var mark;
  if (entry.logo) {
    mark = document.createElementNS(SVG_NAMESPACE, "svg");
    var use = document.createElementNS(SVG_NAMESPACE, "use");
    use.setAttribute("href", "#logo-" + entry.logo);
    mark.appendChild(use);
  } else if (entry.icon) {
    mark = document.createElement("img");
    mark.src = entry.icon;
  } else {
    mark = document.createElement("span");
    mark.textContent = entry.title;
    className += " mark-text";
  }
  mark.setAttribute("class", "mark " + className);
  return mark;
}

function createTile(entry) {
  var cell = document.createElement("div");
  cell.className = "cell";

  var tile = document.createElement("button");
  tile.className = "tile";
  tile.entry = entry;
  if (entry.color) {
    tile.style.setProperty("--brand", entry.color);
    if (isBright(entry.color)) {
      tile.className = "tile tile-bright";
    }
  }
  // Two copies of the mark: in the brand color at rest, on the brand color when focused.
  tile.appendChild(createMark(entry, "mark-rest"));
  tile.appendChild(createMark(entry, "mark-focus"));
  tile.onclick = function () {
    launch(entry);
  };

  var name = document.createElement("span");
  name.className = "name";
  name.textContent = entry.title;

  cell.appendChild(tile);
  cell.appendChild(name);
  grid.appendChild(cell);
  return tile;
}

function createToolbarButton(entry) {
  var button = document.createElement("button");
  button.className = "pill";
  button.textContent = entry.title;
  button.entry = entry;
  button.onclick = function () {
    launch(entry);
  };
  toolbar.appendChild(button);
  return button;
}

function loadText(url, onLoaded) {
  var request = new XMLHttpRequest();
  request.open("GET", url);
  request.onload = function () {
    try {
      onLoaded(request.responseText);
    } catch (error) {
      showStatus(url + ": " + error.message, true);
    }
  };
  request.onerror = function () {
    showStatus(url + " could not be loaded", true);
  };
  request.send();
}

function loadJson(url, onLoaded) {
  loadText(url, function (text) {
    onLoaded(JSON.parse(text));
  });
}

function greetingFor(hour) {
  if (hour >= 5 && hour < 12) {
    return "Good morning";
  }
  if (hour >= 12 && hour < 18) {
    return "Good afternoon";
  }
  if (hour >= 18 && hour < 23) {
    return "Good evening";
  }
  return "Still up?";
}

function showClock() {
  var now = new Date();
  var minutes = now.getMinutes();
  clock.textContent = now.getHours() + ":" + (minutes < 10 ? "0" : "") + minutes;
  greeting.textContent = greetingFor(now.getHours());
  date.textContent = WEEKDAYS[now.getDay()] + ", " + now.getDate() + " " + MONTHS[now.getMonth()];
}

// Updates once per minute, right at the minute change.
function runClock() {
  var now = new Date();
  showClock();
  setTimeout(runClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

document.addEventListener("keydown", onKeyDown);
runClock();
loadText("logos.svg", function (sprite) {
  document.body.insertAdjacentHTML("beforeend", sprite);
});
loadJson("toolbar.json", function (entries) {
  toolbarButtons = entries.map(createToolbarButton);
});
loadJson("catalog.json", function (entries) {
  tiles = entries.map(createTile);
  focusAt(tiles, 0);
});
