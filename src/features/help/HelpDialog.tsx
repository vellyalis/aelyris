import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import styles from "./HelpDialog.module.css";

interface HelpDialogProps {
  visible: boolean;
  onClose: () => void;
}

type HelpSection = "overview" | "terminal" | "editor" | "agent" | "workflow" | "toolkit" | "shortcuts";

const SECTIONS: { id: HelpSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "terminal", label: "Terminal" },
  { id: "editor", label: "Editor" },
  { id: "agent", label: "AI Agent" },
  { id: "workflow", label: "Workflow" },
  { id: "toolkit", label: "Toolkit" },
  { id: "shortcuts", label: "Shortcuts" },
];

const HELP_CONTENT: Record<HelpSection, { title: string; items: string[] }> = {
  overview: {
    title: "Aether Terminal",
    items: [
      "AI-integrated development workspace for Windows.",
      "Combines terminal, editor, AI agents, and workflow engine in one window.",
      "Open a project folder to get started. All features activate around the project context.",
      "Use Ctrl+Shift+P to open the Command Palette for quick access to any feature.",
    ],
  },
  terminal: {
    title: "Terminal",
    items: [
      "PowerShell, CMD, Git Bash, and WSL shells supported.",
      "Ctrl+Shift+T: New terminal tab. Ctrl+Shift+W: Close tab.",
      "Ctrl+Tab / Ctrl+Shift+Tab: Switch between tabs.",
      "Split panes: Click the split buttons (⎸ or ⎯) in the terminal info bar.",
      "Ctrl+F: Search within terminal output.",
      "Ghost typing: Start typing a command and Tab to accept the suggestion from history.",
      "Command history: Click the clock icon to browse and re-run past commands.",
      "Error detection: Build/test errors are automatically detected with 'Ask AI to fix' option.",
      "Image paste: Ctrl+V pastes images as file paths (auto-saved to temp).",
      "Sync mode: Click ⇄ to broadcast keystrokes to all panes simultaneously.",
    ],
  },
  editor: {
    title: "Editor",
    items: [
      "Click any file in the File Tree to open it in Monaco Editor.",
      "Ctrl+S: Save file. Ctrl+W: Close file.",
      "Ctrl+P: Quick Open — fuzzy search for files. Tab switches to buffer mode.",
      "Diff mode: Click 'Diff' button to compare with git HEAD version.",
      "Markdown preview: Click 'Preview' for rendered markdown view.",
      "Vim mode: Click 'Vim' to toggle Vim keybindings.",
      "Inline diff comments: In diff mode, click the gutter to leave feedback for AI agent.",
      "Unsaved changes: A dot (●) appears next to modified files. Close confirmation dialog on exit.",
    ],
  },
  agent: {
    title: "AI Agent",
    items: [
      "Ctrl+Shift+A: Start a headless agent session with a prompt.",
      "Agent Inspector (right panel): View all running sessions, logs, and costs.",
      "Interactive mode: Ctrl+Enter in the prompt input to start a PTY-based interactive session.",
      "Context gauge: Shows token usage percentage per session.",
      "Session actions (right-click): Rename, View Analytics, View Diffs, Create Worktree.",
      "Diffs tab: View files changed by the agent with Accept/Revert/AI Review buttons.",
      "Orchestra mode (♫ button): Launch 3 agents simultaneously (Implementer + Tester + Reviewer).",
      "Parallel view: Automatically switches when 2+ agents are running. Shows Stop All button.",
      "Cost tracking: Total session cost displayed in the tab bar.",
    ],
  },
  workflow: {
    title: "Workflow Engine",
    items: [
      "Workflows are multi-phase AI automation pipelines defined in YAML.",
      "Place YAML files in .aether/workflows/ to make them available.",
      "Click a workflow name to start it. Each phase spawns an AI agent.",
      "Quality gates: Approve (✓) or Reject (✗) at gate points between phases.",
      "Visual Builder: Click 'Visual Builder' to design workflows with drag-and-drop nodes.",
      "Built-in templates: Feature, Bug Fix, Refactoring, Code Review.",
      "Import/Export: Import YAML files or export from Visual Builder.",
      "Phase details: Click any phase step to expand its status, cost, and agent ID.",
    ],
  },
  toolkit: {
    title: "Toolkit",
    items: [
      "Quick-action buttons for common commands (Git, Dev Server, Tests, etc.).",
      "Right-click any button to edit its label and command.",
      "'+' button: Add custom tools with any shell command.",
      "Import: Paste JSON or load a .json file to import tool definitions.",
      "Dangerous command detection: Warnings shown before running risky commands.",
      "Commit & Push: Prompts for a commit message before executing.",
      "Placeholder syntax: Use {name} in commands for runtime prompts (e.g., git commit -m \"{message}\").",
    ],
  },
  shortcuts: {
    title: "Keyboard Shortcuts",
    items: [
      "Ctrl+Shift+P — Command Palette",
      "Ctrl+P — Quick Open (file search)",
      "Ctrl+N — New File",
      "Ctrl+, — Settings",
      "Ctrl+Shift+O — Open Folder",
      "Ctrl+` — Focus Terminal",
      "Ctrl+Shift+T — New Terminal Tab",
      "Ctrl+Shift+W — Close Terminal Tab",
      "Ctrl+Tab / Ctrl+Shift+Tab — Switch Tabs",
      "Ctrl+F — Search in Terminal",
      "Ctrl+S — Save File",
      "Ctrl+W — Close File",
      "Ctrl+Shift+F — Search in Files",
      "Ctrl+Shift+A — Start Agent",
      "Ctrl+[ / Ctrl+] — Previous/Next Agent Session",
    ],
  },
};

export function HelpDialog({ visible, onClose }: HelpDialogProps) {
  const [section, setSection] = useState<HelpSection>("overview");
  const content = HELP_CONTENT[section];

  return (
    <AnimatePresence>
    {visible && (
    <motion.div className={styles.overlay} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <motion.div className={styles.dialog} onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Help</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className={styles.body}>
          <nav className={styles.nav}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`${styles.navItem} ${section === s.id ? styles.navActive : ""}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className={styles.content}>
            <h3 className={styles.sectionTitle}>{content.title}</h3>
            <ul className={styles.list}>
              {content.items.map((item, i) => (
                <li key={i} className={styles.item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
