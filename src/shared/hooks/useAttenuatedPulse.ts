import { useEffect, useState } from "react";

export type PulsePhase = "active" | "ambient" | "off";

/**
 * Two-phase attenuation for status-pulse animations.
 *
 * When `isActive` flips to `true` the hook returns `"active"` immediately,
 * then transitions to `"ambient"` after `activeDurationMs`. When `isActive`
 * flips back to `false` the hook returns `"off"` at once.
 *
 * Why this exists: agents can stay in a single state (thinking / coding /
 * generating) for many minutes. An infinite 2 s pulse during that window
 * pins GPU frames, accumulates peripheral-vision noise, and — worst of all —
 * habituates. After ~30 s the eye has stopped registering it, so the signal
 * is already gone. Collapsing into a slow ambient breath keeps liveness
 * visible at 1/5th the frame rate without ever going fully silent (which
 * would read as "frozen").
 *
 * The phase boundary is configurable so individual surfaces can tune it
 * against their own rhythm — 30 s is a reasonable default for agent status,
 * but a ContextGauge critical pulse might prefer a different cadence.
 */
export function useAttenuatedPulse(isActive: boolean, activeDurationMs = 30_000): PulsePhase {
  const [phase, setPhase] = useState<PulsePhase>(isActive ? "active" : "off");

  useEffect(() => {
    if (!isActive) {
      setPhase("off");
      return;
    }
    setPhase("active");
    const timer = setTimeout(() => setPhase("ambient"), activeDurationMs);
    return () => clearTimeout(timer);
  }, [isActive, activeDurationMs]);

  return phase;
}
