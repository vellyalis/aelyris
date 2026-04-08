import { useTerminal } from "../hooks/useTerminal";
import styles from "./TerminalView.module.css";

interface TerminalViewProps {
  shell?: string;
  cwd?: string;
}

export function TerminalView({ shell, cwd }: TerminalViewProps) {
  const { ref, fit } = useTerminal({ shell, cwd });

  return (
    <div
      className={styles.terminalContainer}
      ref={(node) => {
        if (node) {
          ref(node);
          // Fit after container is mounted and sized
          requestAnimationFrame(() => fit());
        }
      }}
    />
  );
}
