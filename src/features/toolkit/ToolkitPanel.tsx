import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  ClipboardList,
  FileUp,
  FlaskConical,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Play,
  Plus,
  ScrollText,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useState } from "react";
import { detectDangerousCommand } from "../../shared/lib/shellSafety";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { showPrompt } from "../../shared/ui/PromptDialog";
import styles from "./ToolkitPanel.module.css";

const ICON_MAP: Record<string, React.ReactNode> = {
  "create-pr": <GitPullRequest size={12} />,
  "commit-push": <Upload size={12} />,
  worktree: <GitBranch size={12} />,
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
  {
    id: "commit-push",
    label: "Commit & Push",
    badge: "var(--ctp-green)",
    command: 'git add -A && git commit -m "{message}" && git push',
  },
  { id: "worktree", label: "Worktree", badge: "var(--ctp-blue)", command: "git worktree list" },
  { id: "dev-server", label: "Dev Server", badge: "var(--ctp-green)", command: "pnpm dev" },
  { id: "open-vscode", label: "Open in VSCode", badge: "var(--ctp-blue)", command: "code ." },
  { id: "git-status", label: "Git Status", badge: "var(--ctp-yellow)", command: "git status" },
  { id: "git-log", label: "Git Log", badge: "var(--text-secondary)", command: "git log --oneline -15" },
  { id: "npm-test", label: "Run Tests", badge: "var(--ctp-red)", command: "npm test" },
];

function actionTone(action: ToolkitAction): "git" | "runtime" | "test" | "workspace" | "custom" {
  if (["create-pr", "commit-push", "git-status", "git-log", "worktree"].includes(action.id)) return "git";
  if (action.id === "dev-server") return "runtime";
  if (action.id === "npm-test") return "test";
  if (action.id === "open-vscode") return "workspace";
  return "custom";
}

// Validate that a parsed object has the minimum shape we need. Without this,
// a corrupted localStorage entry — or an older app version that stored a
// different schema — would surface as a TypeError later when handlers read
// `a.command.match(...)` on a non-string. Drop unknown entries silently and
// fall back to DEFAULT_ACTIONS if nothing usable remains.
function isValidAction(value: unknown): value is ToolkitAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.badge === "string" &&
    typeof v.command === "string"
  );
}

function loadActions(projectName: string): ToolkitAction[] {
  try {
    const saved = localStorage.getItem(`aether:toolkit:${projectName}`);
    if (!saved) return DEFAULT_ACTIONS;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_ACTIONS;
    // Empty array = user intentionally deleted every action. Preserve
    // that — restoring DEFAULT_ACTIONS here would resurrect the
    // buttons the user explicitly removed (Codex r0).
    if (parsed.length === 0) return [];
    const valid = parsed.filter(isValidAction);
    // Some entries valid → take what we recovered. All entries invalid
    // → the saved blob is corrupt (older schema, partial write); fall
    // back to defaults rather than show a permanently empty toolkit.
    return valid.length > 0 ? valid : DEFAULT_ACTIONS;
  } catch {
    return DEFAULT_ACTIONS;
  }
}

// Collision-resistant id generator. The previous `import-${Date.now()}-${i}`
// scheme produced duplicate ids when two imports landed inside the same
// millisecond — React's reconciliation then keyed multiple list items to
// the same node, causing one of them to render the other's content. Use
// crypto.randomUUID() with a Math.random() fallback for environments
// (older webviews, jsdom in some configs) that lack it.
function makeActionId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveActions(projectName: string, actions: ToolkitAction[]) {
  try {
    localStorage.setItem(`aether:toolkit:${projectName}`, JSON.stringify(actions));
  } catch {
    /* ignore */
  }
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
  const primaryActionId = actions.find((action) => action.id === "dev-server")?.id ?? actions[0]?.id;

  const handleEdit = useCallback((action: ToolkitAction) => {
    setEditingId(action.id);
    setEditLabel(action.label);
    setEditCommand(action.command);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const updated = actions.map((a) => (a.id === editingId ? { ...a, label: editLabel, command: editCommand } : a));
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
      id: makeActionId("custom"),
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

      const toAction = (obj: Record<string, unknown>): ToolkitAction => ({
        id: makeActionId("import"),
        label: String(obj.label ?? obj.name ?? "Imported Tool"),
        icon: typeof obj.icon === "string" ? obj.icon : undefined,
        badge: typeof obj.badge === "string" ? obj.badge : "var(--ctp-cyan)",
        command: String(obj.command ?? obj.cmd ?? ""),
      });

      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object" && (item.command || item.cmd)) {
            items.push(toAction(item));
          }
        });
      } else if (typeof parsed === "object" && parsed !== null && (parsed.command || parsed.cmd)) {
        items.push(toAction(parsed));
      }

      if (items.length > 0) {
        setImportParsed(items);
        return;
      }
    } catch {
      /* not JSON, fall through */
    }

    // Fallback: treat each non-empty line as a raw command
    const lines = trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const items = lines.map(
      (line): ToolkitAction => ({
        id: makeActionId("import"),
        label: line.split(" ").slice(0, 3).join(" "),
        badge: "var(--ctp-cyan)",
        command: line,
      }),
    );
    setImportParsed(items);
  }, []);

  const handleImport = useCallback(async () => {
    if (!importParsed || importParsed.length === 0) return;
    // Check for dangerous commands in import
    const dangers = importParsed
      .map((a) => ({ label: a.label, warning: detectDangerousCommand(a.command) }))
      .filter((d) => d.warning !== null);
    if (dangers.length > 0) {
      const msg = dangers.map((d) => `${d.label}: ${d.warning}`).join("\n");
      const ok = await showConfirm({
        title: "Dangerous commands detected",
        description: `Imported commands contain dangerous patterns:\n\n${msg}\n\nImport anyway?`,
        confirmLabel: "Import",
        tone: "danger",
      });
      if (!ok) return;
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
    <div className={styles.toolkit} role="region" aria-label="Toolkit">
      <PanelHeader
        title="Toolkit"
        leadingIcon={<Sparkles size={12} />}
        subtitle="Command deck"
        count={actions.length}
        actions={
          <button className={styles.addBtn} onClick={handleAdd} title="Add action" aria-label="Add tool">
            <Plus size={12} aria-hidden="true" />
          </button>
        }
      />

      {editingId && (
        <div
          className={styles.editForm}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditingId(null);
          }}
        >
          <input
            className={styles.editInput}
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            placeholder="Label"
            aria-label="Tool label"
          />
          <input
            className={styles.editInput}
            value={editCommand}
            onChange={(e) => setEditCommand(e.target.value)}
            placeholder="Command"
            aria-label="Tool command"
          />
          <div className={styles.editActions}>
            <button className={styles.editDelete} onClick={handleDelete}>
              Delete
            </button>
            <button className={styles.editCancel} onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className={styles.editSave} onClick={handleSaveEdit}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {actions.map((a) => {
          const priority = a.id === primaryActionId ? "primary" : "orbit";
          return (
            <button
              type="button"
              key={a.id}
              className={styles.action}
              data-priority={priority}
              data-tone={actionTone(a)}
              onClick={async () => {
                let command = a.command;
                // Prompt for placeholders like {message}
                const placeholders = command.match(/\{(\w+)\}/g);
                if (placeholders) {
                  for (const ph of [...new Set(placeholders)]) {
                    const name = ph.slice(1, -1);
                    const value = await showPrompt(`Enter ${name}`, { placeholder: `${name}...` });
                    if (!value) return;
                    command = command.split(ph).join(value.replace(/"/g, '\\"'));
                  }
                }
                const warning = detectDangerousCommand(command);
                if (warning) {
                  // Previously this was a text prompt with `defaultValue: "yes"` —
                  // a single-character typo would execute an `rm -rf`-class
                  // command. Use an explicit confirm with a danger-tone button
                  // and Cancel pre-focused.
                  const ok = await showConfirm({
                    title: "Run dangerous command?",
                    description: `${warning}\n\nCommand:\n${command}`,
                    confirmLabel: "Run anyway",
                    cancelLabel: "Cancel",
                    tone: "danger",
                  });
                  if (!ok) return;
                }
                onRunCommand?.(command);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                handleEdit(a);
              }}
              title={a.command}
            >
              <span className={styles.actionIcon}>{ICON_MAP[a.id] ?? null}</span>
              <span className={styles.actionBody}>
                <span className={styles.actionLabel}>{a.label}</span>
                <span className={styles.actionCommand}>{a.command}</span>
              </span>
              <span className={styles.badge} style={{ background: a.badge }} />
            </button>
          );
        })}
      </div>
      <div className={styles.bottomActions}>
        <button
          type="button"
          className={styles.bottomBtn}
          onClick={async () => {
            const cmd = await showPrompt("Generate Tool", { placeholder: "Describe what the tool should do..." });
            if (cmd) {
              const newAction: ToolkitAction = {
                id: makeActionId("gen"),
                label: cmd.split(" ").slice(0, 3).join(" "),
                badge: "var(--ctp-mauve)",
                command: cmd,
              };
              const updated = [...actions, newAction];
              setActions(updated);
              saveActions(projectName, updated);
            }
          }}
        >
          <Sparkles size={11} aria-hidden="true" />
          <span>Generate</span>
        </button>
        <button type="button" className={styles.bottomBtn} onClick={handleAdd}>
          <Plus size={11} aria-hidden="true" />
          <span>Create</span>
        </button>
        <button type="button" className={styles.bottomBtn} onClick={() => setImportOpen(true)}>
          <FileUp size={11} aria-hidden="true" />
          <span>Import</span>
        </button>
      </div>

      {/* Import Tool Dialog */}
      <Dialog.Root
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportText("");
            setImportParsed(null);
            setImportError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.importOverlay} />
          <Dialog.Content className={styles.importPanel} aria-describedby={undefined}>
            <Dialog.Title className={styles.importTitle}>Import Tool</Dialog.Title>
            <p className={styles.importHint}>Paste JSON recipe, raw commands, or load a .json file.</p>
            <textarea
              className={styles.importTextarea}
              placeholder={'{\n  "label": "My Tool",\n  "command": "echo hello"\n}\n\n— or just paste a command —'}
              aria-label="Tool recipe JSON or raw command"
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
                <FileUp size={14} /> File
              </button>
              <div className={styles.importActionsSpacer} />
              <Dialog.Close asChild>
                <button className={styles.importCancel}>Cancel</button>
              </Dialog.Close>
              <button
                className={styles.importSubmit}
                onClick={handleImport}
                disabled={!importParsed || importParsed.length === 0}
              >
                Import{importParsed && importParsed.length > 1 ? ` (${importParsed.length})` : ""}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
