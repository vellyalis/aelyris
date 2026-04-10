import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import type { ReactNode } from "react";
import styles from "./ScrollArea.module.css";

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export function ScrollArea({ children, className }: ScrollAreaProps) {
  return (
    <RadixScrollArea.Root className={`${styles.root} ${className ?? ""}`}>
      <RadixScrollArea.Viewport className={styles.viewport}>
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar className={styles.scrollbar} orientation="vertical">
        <RadixScrollArea.Thumb className={styles.thumb} />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
