import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, Menu as MenuIcon } from "lucide-react";
import styles from "./MenuBar.module.css";

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: Menu[];
}

/**
 * Single hamburger entry that fans out into the full menu tree —
 * matches the chrome of Claude Code Desktop, VS Code, and modern
 * Mac apps. The previous horizontal menubar (File / Edit / View /
 * Terminal / Help laid out left-to-right under the header) was a
 * Win32-era pattern that read as old-fashioned next to today's
 * compact app shells.
 *
 * Implementation: Radix `DropdownMenu.Sub` lets each top-level
 * label expand into a submenu without hand-rolling positioning.
 * Keyboard nav (Arrow keys, Esc, Enter) is handled by Radix; the
 * surface keeps the same `Menu`/`MenuItem` data contract so
 * `useAppMenus` does not need to change.
 */
export function MenuBar({ menus }: MenuBarProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={styles.hamburger}
          aria-label="Open application menu"
          title="Application menu"
        >
          <MenuIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.dropdown}
          sideOffset={6}
          align="start"
          collisionPadding={8}
        >
          {menus.map((menu) => (
            <DropdownMenu.Sub key={menu.label}>
              <DropdownMenu.SubTrigger className={styles.subTrigger}>
                <span>{menu.label}</span>
                <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className={styles.dropdown}
                  sideOffset={2}
                  alignOffset={-4}
                  collisionPadding={8}
                >
                  {menu.items.map((item, j) =>
                    item.divider ? (
                      <DropdownMenu.Separator key={`sep-${j}`} className={styles.divider} />
                    ) : (
                      <DropdownMenu.Item
                        key={item.label}
                        className={styles.item}
                        disabled={item.disabled}
                        onSelect={() => item.action?.()}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && (
                          <span className={styles.shortcut}>{item.shortcut}</span>
                        )}
                      </DropdownMenu.Item>
                    ),
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
