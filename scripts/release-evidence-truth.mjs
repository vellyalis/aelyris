export function authenticodeEvidenceReady(entries) {
  return (
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every((entry) => entry?.valid === true && entry?.timestamped === true)
  );
}

export function updaterEvidenceReady({ manifestIntegrity, capabilityWired, endpointReachable, lifecycleReady }) {
  return (
    Array.isArray(manifestIntegrity) &&
    manifestIntegrity.length > 0 &&
    manifestIntegrity.every(Boolean) &&
    capabilityWired === true &&
    endpointReachable === true &&
    lifecycleReady === true
  );
}

export function nativeCoverageReportIsHonest(report) {
  return (
    report?.schema === "aelyris.native-coverage-gap/v2" &&
    Number.isInteger(report?.measuredCoveragePercent) &&
    typeof report?.measuredCoverageComplete === "boolean" &&
    report?.shippingShellReady === false &&
    !("fullNativeReady" in report) &&
    !("percent" in report)
  );
}

export function shouldFailReleaseEnforcement(report) {
  return report?.releaseCandidateReady !== true || report?.grade === "D";
}
