import * as RadixSwitch from "@radix-ui/react-switch";
import { forwardRef } from "react";
import styles from "./Switch.module.css";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** Optional accessible label when no visual `label` prop is provided. */
  ariaLabel?: string;
}

/**
 * iOS-style toggle on top of `@radix-ui/react-switch` so the
 * project picks up keyboard + screen-reader semantics for free.
 * Replaces the `<input type="checkbox">` we had scattered across
 * Settings / Watchdog / Kanban — those native checkboxes were the
 * loudest "old chrome" tell on the panels (square, blue OS-tinted,
 * no animation).
 *
 * The visual is a 32 × 18 pill with a 14 × 14 thumb that slides
 * 14 px on toggle, rendered in the Aether gold accent when on.
 * Pair it with an external `<label htmlFor>` or use the inline
 * `label` prop to bake the row in one shot.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { id, checked, onCheckedChange, disabled, label, hint, ariaLabel },
  ref,
) {
  const control = (
    <RadixSwitch.Root
      id={id}
      ref={ref}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={styles.root}
    >
      <RadixSwitch.Thumb className={styles.thumb} />
    </RadixSwitch.Root>
  );

  if (!label) return control;

  return (
    <label className={styles.row} htmlFor={id}>
      {control}
      <span className={styles.copy}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
    </label>
  );
});
