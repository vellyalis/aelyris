import * as RadixContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import styles from "./ContextMenu.module.css";

interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  children: ReactNode;
  items: ContextMenuItem[];
}

export function ContextMenu({ children, items }: ContextMenuProps) {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        {children}
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={styles.menu}>
          {items.map((item, i) =>
            item.divider ? (
              <RadixContextMenu.Separator key={`sep-${i}`} className={styles.divider} />
            ) : (
              <RadixContextMenu.Item
                key={item.label}
                className={styles.item}
                disabled={item.disabled}
                onSelect={item.action}
              >
                {item.label}
              </RadixContextMenu.Item>
            )
          )}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
