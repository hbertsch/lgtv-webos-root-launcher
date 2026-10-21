// Pure part of the catalog build: matches wanted apps against the TV's launch points.

function findByTitle(launchPoints, match) {
  const needle = match.toLowerCase();
  const exactMatch = launchPoints.find((launchPoint) => launchPoint.title.toLowerCase() === needle);
  if (exactMatch) {
    return exactMatch;
  }
  return launchPoints.find((launchPoint) => launchPoint.title.toLowerCase().includes(needle));
}

function iconUrlOf(launchPoint) {
  return launchPoint?.largeIcon || launchPoint?.icon;
}

// Returns the resolved apps in the order of wantedApps plus the titles that found no launch point.
export function resolveWantedApps(launchPoints, wantedApps) {
  const resolvedApps = [];
  const missingTitles = [];

  for (const wantedApp of wantedApps) {
    const launchPoint = wantedApp.appId
      ? launchPoints.find((candidate) => candidate.id === wantedApp.appId)
      : findByTitle(launchPoints, wantedApp.match);

    if (!wantedApp.appId && !launchPoint) {
      missingTitles.push(wantedApp.title);
      continue;
    }
    const resolvedApp = {
      title: wantedApp.title,
      appId: wantedApp.appId || launchPoint.id,
      iconUrl: iconUrlOf(launchPoint),
    };
    if (wantedApp.color) {
      resolvedApp.color = wantedApp.color;
    }
    if (wantedApp.logo) {
      resolvedApp.logo = wantedApp.logo;
    }
    resolvedApps.push(resolvedApp);
  }

  return { resolvedApps, missingTitles };
}
