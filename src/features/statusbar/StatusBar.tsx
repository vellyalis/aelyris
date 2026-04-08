import { useState } from "react";
import type { ShellType } from "../../App";
import styles from "./StatusBar.module.css";

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

const SHELL_OPTIONS: ShellType[] = ["powershell", "cmd", "gitbash", "wsl"];

interface StatusBarProps {
  activeShell: ShellType;
  onShellChange: (shell: ShellType) => void;
}

export function StatusBar({ activeShell, onShellChange }: StatusBarProps) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className={styles.statusbar}>
      <div className={styles.left}>
        <button
          className={styles.shellBtn}
          onClick={() => setShowPicker(!showPicker)}
        >
          {SHELL_LABELS[activeShell]} ▾
        </button>
        {showPicker && (
          <div className={styles.picker}>
            {SHELL_OPTIONS.map((s) => (
              <button
                key={s}
                className={`${styles.pickerItem} ${s === activeShell ? styles.active : ""}`}
                onClick={() => {
                  onShellChange(s);
                  setShowPicker(false);
                }}
              >
                {SHELL_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.right}>
        <span className={styles.item}>Aether v0.1.0</span>
      </div>
    </div>
  );
}
