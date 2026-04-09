import { useState, useRef, useEffect } from "react";
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
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (openMenu === null) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  return (
    <div className={styles.bar} ref={barRef} role="menubar" aria-label="Application menu">
      {menus.map((menu, i) => (
        <div key={menu.label} className={styles.menuWrapper}>
          <button
            className={`${styles.menuBtn} ${openMenu === i ? styles.menuBtnActive : ""}`}
            onClick={() => setOpenMenu(openMenu === i ? null : i)}
            onMouseEnter={() => openMenu !== null && setOpenMenu(i)}
          >
            {menu.label}
          </button>
          {openMenu === i && (
            <div className={styles.dropdown} role="menu" aria-label={menu.label}>
              {menu.items.map((item, j) =>
                item.divider ? (
                  <div key={j} className={styles.divider} />
                ) : (
                  <button
                    key={j}
                    className={styles.item}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.action?.();
                      setOpenMenu(null);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
