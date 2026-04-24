import { Square } from "lucide-react";

interface StopButtonProps {
  /** Called when the user activates the button via click / Enter / Space. */
  onStop: () => void;
  /** Accessible label, e.g. "Stop session Agent 42". */
  label?: string;
  /** CSS class applied to the button element. */
  className?: string;
}

/**
 * A span-based "stop" control that lives inside a card/row that is itself
 * a <button>. Using a real <button> here would nest interactive elements
 * (invalid HTML); using a plain <span onClick> is unreachable by keyboard.
 *
 * role="button" + tabIndex=0 + explicit Enter/Space handling keeps the
 * control keyboard-reachable without nesting <button> inside <button>.
 * All events stop propagation so activating stop does not also trigger
 * the parent card's onClick.
 */
export function StopButton({ onStop, label = "Stop", className }: StopButtonProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onStop();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onStop();
        }
      }}
    >
      <Square size={10} strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}
