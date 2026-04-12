import { useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { GitPullRequest, Upload, GitBranch, Play, FolderOpen, ClipboardList, ScrollText, FlaskConical, FileUp, AlertCircle } from "lucide-react";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { detectDangerousCommand } from "../../shared/lib/shellSafety";
import styles from "./ToolkitPanel.module.css";

const ICON_MAP: Record<string, React.ReactNode> = {
  "create-pr": <GitPullRequest size={12} />,
  "commit-push": <Upload size={12} />,
  "worktree": <GitBranch size={12} />,
  "dev-server": <Play size={12} />,
  "open-vscode": <FolderOpen size={12} />,
  "git-status": <ClipboardList size={12} />,
  "git-log": <ScrollText size={12} />,
  "npm-test": <FlaskConical size={12} />,
};

export interface ToolkitAction {
  id: string;
  label: string;
  icon?: string;
  badge: string;
  command: string;
}

interface ToolkitPanelProps {
  projectName?: string;
  onRunCommand?: (command: string) => void;
}

const DEFAULT_ACTIONS: ToolkitAction[] = [
  { id: "create-pr", label: "Create PR", badge: "var(--ctp-mauve)", command: "gh pr create --fill" },
  { id: "commit-push", label: "Commit & Push", badge: "var(--ctp-green)", command: "git add -A && git commit && git push" },
  { id: "worktree", label: "Worktree", badge: "var(--ctp-blue)", command: "git worktree list" },
  { id: "dev-server", label: "Dev Server", badge: "var(--ctp-green)", command: "pnpm dev" },
  { id: "open-vscode", label: "Open in VSCode", badge: "var(--ctp-blue)", command: "code ." },
  { id: "git-status", label: "Git Status", badge: "var(--ctp-yellow)", command: "git status" },
  { id: "git-log", label: "Git Log", badge: "var(--text-secondary)", command: "git log --oneline -15" },
  { id: "npm-test", label: "Run Tests", badge: "var(--ctp-red)", command: "npm test" },
];

function loadActions(projectName: string): ToolkitAction[] {
  try {
    const saved = localStorage.getItem(`aether:toolkit:${projectName}`);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_ACTIONS;
}

function saveActions(projectName: string, actions: ToolkitAction[]) {
  try { localStorage.setItem(`aether:toolkit:${projectName}`, JSON.stringify(actions)); } catch { /* ignore */ }
}

export function ToolkitPanel({ projectName = "default", onRunCommand }: ToolkitPanelProps) {
  const [actions, setActions] = useState<ToolkitAction[]>(() => loadActions(projectName));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCommand, setEditCommand] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importParsed, setImportParsed] = useState<ToolkitAction[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleEdit = useCallback((action: ToolkitAction) => {
    setEditingId(action.id);
    setEditLabel(action.label);
    setEditCommand(action.command);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const updated = actions.map((a) =>
      a.id === editingId ? { ...a, label: editLabel, command: editCommand } : a
    );
    setActions(updated);
    saveActions(projectName, updated);
    setEditingId(null);
  }, [editingId, editLabel, editCommand, actions, projectName]);

  const handleAdd = useCallback(async () => {
    const label = await showPrompt("Add Tool", { placeholder: "Button label..." });
    if (!label) return;
    const command = await showPrompt("Command", { placeholder: "Command to run..." });
    if (!command) return;
    const newAction: ToolkitAction = {
      id: `custom-${Date.now()}`,
      label,
      badge: "var(--ctp-cyan)",
      command,
    };
    const updated = [...actions, newAction];
    setActions(updated);
    saveActions(projectName, updated);
  }, [actions, projectName]);

  const handleDelete = useCallback(() => {
    if (!editingId) return;
    const updated = actions.filter((a) => a.id !== editingId);
    setActions(updated);
    saveActions(projectName, updated);
    setEditingId(null);
  }, [editingId, actions, projectName]);

  const parseImportText = useCallback((text: string) => {
    setImportText(text);
    setImportError(null);
    setImportParsed(null);

    const trimmed = text.trim();
    if (!trimmed) return;

    // Try JSON parse first
    try {
      const parsed = JSON.parse(trimmed);
      const items: ToolkitAction[] = [];

      const toAction = (obj: Record<string, unknown>, i: number): ToolkitAction => ({
        id: `import-${Date.now()}-${i}`,
        label: String(obj.label ?? obj.name ?? "Imported Tool"),
        icon: typeof obj.icon === "string" ? obj.icon : undefined,
        badge: typeof obj.badge === "string" ? obj.badge : "var(--ctp-cyan)",
        command: String(obj.command ?? obj.cmd ?? ""),
      });

      if (Array.isArray(parsed)) {
        parsed.forEach((item, i) => {
          if (item && typeof item === "object" && (item.command || item.cmd)) {
            items.push(toAction(item, i));
          }
        });
      } else if (typeof parsed === "object" && parsed !== null && (parsed.command || parsed.cmd)) {
        items.push(toAction(parsed, 0));
      }

      if (items.length > 0) {
        setImportParsed(items);
        return;
      }
    } catch { /* not JSON, fall through */ }

    // Fallback: treat each non-empty line as a raw command
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    const items = lines.map((line, i): ToolkitAction => ({
      id: `import-${Date.now()}-${i}`,
      label: line.split(" ").slice(0, 3).join(" "),
      badge: "var(--ctp-cyan)",
      command: line,
    }));
    setImportParsed(items);
  }, []);

  const handleImport = useCallback(() => {
    if (!importParsed || importParsed.length === 0) return;
    // Check for dangerous commands in import
    const dangers = importParsed
      .map((a) => ({ label: a.label, warning: detectDangerousCommand(a.command) }))
      .filter((d) => d.warning !== null);
    if (dangers.length > 0) {
      const msg = dangers.map((d) => `${d.label}: ${d.warning}`).join("\n");
      if (!confirm(`Warning: imported commands contain dangerous patterns:\n\n${msg}\n\nImport anyway?`)) return;
    }
    const updated = [...actions, ...importParsed];
    setActions(updated);
    saveActions(projectName, updated);
    setImportText("");
    setImportParsed(null);
    setImportError(null);
    setImportOpen(false);
  }, [importParsed, actions, projectName]);

  const handleImportFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          parseImportText(reader.result);
        }
      };
      reader.onerror = () => setImportError("Failed to read file");
      reader.readAsText(file);
    };
    input.click();
  }, [parseImportText]);

  return (
    <div className={styles.toolkit}>
      <div className={styles.header}>
        <span className={styles.title}>Toolkit</span>
        <span className={styles.project}>{projectName}</span>
        <button className={styles.addBtn} onClick={handleAdd} title="Add action">+</button>
      </div>

      {editingId && (
        <div className={styles.editForm} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditingId(null); }}>
          <input className={styles.editInput} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" />
          <input className={styles.editInput} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Command" />
          <div className={styles.editActions}>
            <button className={styles.editDelete} onClick={handleDelete}>Delete</button>
            <button className={styles.editCancel} onClick={() => setEditingId(null)}>Cancel</button>
            <button className={styles.editSave} onClick={handleSaveEdit}>Save</button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {actions.map((a) => (
          <button
            key={a.id}
            className={styles.action}
            onClick={async () => {
              const warning = detectDangerousCommand(a.command);
              if (warning) {
                const ok = await showPrompt("Run dangerous command?", {
                  placeholder: `${warning}\n\nCommand: ${a.command}`,
                  defaultValue: "yes",
                });
                if (ok !== "yes") return;
              }
              onRunCommand?.(a.command);
            }}
            onContextMenu={(e) => { e.preventDefault(); handleEdit(a); }}
            title={a.command}
          >
            <span className={styles.actionIcon}>{ICON_MAP[a.id] ?? null}</span>
            <span className={styles.actionLabel}>{a.label}</span>
            <span className={styles.badge} style={{ background: a.badge }} />
          </button>
        ))}
      </div>
      <div className={styles.bottomActions}>
        <button className={styles.bottomBtn} onClick={async () => { const cmd = await showPrompt("Generate Tool", { placeholder: "Describe what the tool should do..." }); if (cmd) { const newAction: ToolkitAction = { id: `gen-${Date.now()}`, label: cmd.split(" ").slice(0, 3).join(" "), badge: "var(--ctp-mauve)", command: cmd }; const updated = [...actions, newAction]; setActions(updated); saveActions(projectName, updated); } }}>⊕ Generate...</button>
        <button className={styles.bottomBtn} onClick={handleAdd}>⊕ Create...</button>
        <button className={styles.bottomBtn} onClick={() => setImportOpen(true)}>⊕ Import...</button>
      </div>

      {/* Import Tool Dialog */}
      <Dialog.Root open={importOpen} onOpenChange={(open) => {
        setImportOpen(open);
        if (!open) { setImportText(""); setImportParsed(null); setImportError(null); }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.importOverlay} />
          <Dialog.Content className={styles.importPanel} aria-describedby={undefined}>
            <Dialog.Title className={styles.importTitle}>Import Tool</Dialog.Title>
            <p className={styles.importHint}>
              Paste JSON recipe, raw commands, or load a .json file.
            </p>
            <textarea
              className={styles.importTextarea}
              placeholder={'{\n  "label": "My Tool",\n  "command": "echo hello"\n}\n\n— or just paste a command —'}
              value={importText}
              onChange={(e) => parseImportText(e.target.value)}
              rows={5}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) handleImport();
              }}
            />

            {/* Preview */}
            {importParsed && importParsed.length > 0 && (
              <div className={styles.importPreview}>
                <span className={styles.importPreviewLabel}>
                  {importParsed.length} tool{importParsed.length > 1 ? "s" : ""} found:
                </span>
                {importParsed.map((item) => (
                  <div key={item.id} className={styles.importPreviewItem}>
                    <span className={styles.importPreviewName}>{item.label}</span>
                    <span className={styles.importPreviewCmd}>{item.command}</span>
                  </div>
                ))}
              </div>
            )}

            {importError && (
              <div className={styles.importErrorMsg}>
                <AlertCircle size={12} /> {importError}
              </div>
            )}

            <div className={styles.importActions}>
              <button className={styles.importFileBtn} onClick={handleImportFile} title="Load .json file">
                <FileUp size={13} /> File
              </button>
              <div className={styles.importActionsSpacer} />
              <Dialog.Close asChild>
                <button className={styles.importCancel}>Cancel</button>
              </Dialog.Close>
              <button className={styles.importSubmit} onClick={handleImport} disabled={!importParsed || importParsed.length === 0}>
                Import{importParsed && importParsed.length > 1 ? ` (${importParsed.length})` : ""}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
