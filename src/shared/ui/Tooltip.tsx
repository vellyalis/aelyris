import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 400 }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={4}>
          {content}
          <RadixTooltip.Arrow className={styles.arrow} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider>{children}</RadixTooltip.Provider>;
}
