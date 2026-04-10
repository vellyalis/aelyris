import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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

export function MenuBar({ menus }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <div className={styles.bar} role="menubar" aria-label="Application menu">
      {menus.map((menu) => (
        <DropdownMenu.Root
          key={menu.label}
          open={openMenu === menu.label}
          onOpenChange={(open) => setOpenMenu(open ? menu.label : null)}
        >
          <DropdownMenu.Trigger asChild>
            <button
              className={`${styles.menuBtn} ${openMenu === menu.label ? styles.menuBtnActive : ""}`}
              onMouseEnter={() => openMenu !== null && setOpenMenu(menu.label)}
            >
              {menu.label}
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdown}
              sideOffset={2}
              align="start"
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
                )
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </div>
  );
}
