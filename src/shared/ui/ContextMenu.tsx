import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pos]);

  return (
    <div onContextMenu={handleContextMenu} style={{ display: "contents" }}>
      {children}
      {pos && (
        <div ref={menuRef} className={styles.menu} style={{ left: pos.x, top: pos.y }}>
          {items.map((item, i) =>
            item.divider ? (
              <div key={i} className={styles.divider} />
            ) : (
              <button
                key={i}
                className={styles.item}
                disabled={item.disabled}
                onClick={() => { item.action(); setPos(null); }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
