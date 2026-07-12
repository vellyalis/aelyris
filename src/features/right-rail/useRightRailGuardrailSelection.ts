import { useEffect, useRef, useState } from "react";
import {
  isRightRailGuardrailSelection,
  loadRightRailGuardrailSelection,
  RIGHT_RAIL_GUARDRAIL_SYNC_EVENT,
  saveRightRailGuardrailSelection,
  type RightRailGuardrailSelection,
} from "./rightRailModel";

export function useRightRailGuardrailSelection() {
  const [rightRailGuardrailSelection, setRightRailGuardrailSelection] = useState<RightRailGuardrailSelection>(
    loadRightRailGuardrailSelection,
  );
  const initialPersistRef = useRef(false);

  useEffect(() => {
    const onSync = (event: Event) => {
      const selection = (event as CustomEvent<{ selection?: unknown }>).detail?.selection;
      if (typeof selection === "string" && isRightRailGuardrailSelection(selection)) {
        setRightRailGuardrailSelection(selection);
      }
    };
    window.addEventListener(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, onSync);
    return () => window.removeEventListener(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, onSync);
  }, []);

  useEffect(() => {
    if (!initialPersistRef.current) {
      initialPersistRef.current = true;
      if (rightRailGuardrailSelection === "Auto") return;
    }
    saveRightRailGuardrailSelection(rightRailGuardrailSelection);
  }, [rightRailGuardrailSelection]);

  return { rightRailGuardrailSelection, setRightRailGuardrailSelection };
}
