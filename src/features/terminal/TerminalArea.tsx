import { TerminalView } from "./components/TerminalView";
import styles from "./TerminalArea.module.css";

export function TerminalArea() {
  return (
    <div className={styles.terminalArea}>
      <TerminalView shell="powershell" />
    </div>
  );
}
