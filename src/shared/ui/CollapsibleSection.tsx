import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import styles from "./CollapsibleSection.module.css";

export interface CollapsibleSectionProps {
  /** Stable key used to persist the open/closed state to
   *  localStorage so it survives reloads. Required because every
   *  visible section in the sidebar gets its own slot. */
  storageKey: string;
  /** Section header label, all-caps small typography. */
  title: string;
  /** Optional header-right slot for action buttons (e.g. New
   *  File, Refresh, Filter). */
  actions?: ReactNode;
  /** Optional starting state when no localStorage entry exists. */
  defaultOpen?: boolean;
  children: ReactNode;
  /** Additional className for the body wrapper — useful when the
   *  hosted panel needs to claim a flex grow value of its own. */
  bodyClassName?: string;
}

/**
 * Sidebar accordion section. The chrome (header strip + chevron +
 * actions) keeps the sidebar tidy at small widths and matches the
 * Warp / VS Code "fold panels you don't currently need" pattern.
 *
 * Persists open/closed state under
 * `aelyris:section:<storageKey>` so reloads remember which
 * section the user had collapsed (the FileTree might still be
 * open when SCM is folded away, etc.).
 */
export function CollapsibleSection({
  storageKey,
  title,
  actions,
  defaultOpen = true,
  children,
  bodyClassName,
}: CollapsibleSectionProps) {
  const fullKey = `aelyris:section:${storageKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const persisted = localStorage.getItem(fullKey);
      return persisted === null ? defaultOpen : persisted === "1";
    } catch {
      return defaultOpen;
    }
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(fullKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [fullKey],
  );

  return (
    <Collapsible.Root open={open} onOpenChange={handleOpenChange} className={styles.root}>
      <Collapsible.Trigger asChild>
        <button type="button" className={styles.header} aria-label={`Toggle ${title}`}>
          <ChevronDown size={12} strokeWidth={2.25} className={styles.chevron} aria-hidden="true" />
          <span className={styles.title}>{title}</span>
          {actions && (
            /* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Header action controls stop propagation so they do not toggle the collapsible trigger. */
            <span
              className={styles.actions}
              onClick={(e) => {
                // Prevent the action click from toggling the section.
                e.stopPropagation();
              }}
            >
              {actions}
            </span>
          )}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className={`${styles.content} ${bodyClassName ?? ""}`.trim()}>
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
