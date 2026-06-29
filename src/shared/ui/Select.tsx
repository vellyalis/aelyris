import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional secondary label (e.g. "(Light)" suffix). */
  hint?: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Optional id for an external <label htmlFor>. */
  id?: string;
  /** Render the trigger differently — defaults to a glass-pill button. */
  triggerClassName?: string;
}

/**
 * Glass-pill replacement for `<select>`, built on
 * `@radix-ui/react-select`. Native select gives:
 *   - OS-native popup (mismatched chrome on Windows)
 *   - no animation, no glass styling
 *   - inconsistent typography across platforms
 *
 * The Radix version keyboards the same way (Type-ahead, Home/End,
 * Arrow keys), but renders a portal-attached menu we can theme to
 * match the Aelyris dialog surface.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onValueChange, options, placeholder, disabled, ariaLabel, id, triggerClassName },
  ref,
) {
  const selected = options.find((o) => o.value === value);

  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        ref={ref}
        aria-label={ariaLabel}
        className={`${styles.trigger} ${triggerClassName ?? ""}`.trim()}
      >
        <RadixSelect.Value placeholder={placeholder ?? "Select…"}>
          {selected ? <ValueLabel option={selected} /> : (placeholder ?? "Select…")}
        </RadixSelect.Value>
        <RadixSelect.Icon className={styles.icon}>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
          <RadixSelect.Viewport className={styles.viewport}>
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} value={opt.value} className={styles.item}>
                <RadixSelect.ItemIndicator className={styles.itemIndicator}>
                  <Check size={12} strokeWidth={2} aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>
                  <ValueLabel option={opt} />
                </RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
});

function ValueLabel({ option }: { option: SelectOption }): ReactNode {
  if (!option.hint) return option.label;
  return (
    <>
      {option.label}
      <span className={styles.optionHint}>{option.hint}</span>
    </>
  );
}
