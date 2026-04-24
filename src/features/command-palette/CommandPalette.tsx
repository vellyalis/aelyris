import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { loadRecentCommands, recordRecentCommand } from "../../shared/lib/recentCommands";
import styles from "./CommandPalette.module.css";

export type CommandCategory = "Terminal" | "Agent" | "File" | "View" | "History" | "Help";

export interface CommandItem {
  id: string;
  label: string;
  /** Short secondary text describing what the command does. */
  description?: string;
  shortcut?: string;
  category?: CommandCategory;
  /** Optional lucide icon component. Rendered at 14px. */
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  /** Extra tokens (hidden) that cmdk should match against — e.g. "pwsh shell". */
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

const CATEGORY_ORDER: CommandCategory[] = ["Agent", "Terminal", "File", "View", "History", "Help"];

function groupByCategory(items: CommandItem[]): Array<{ category: CommandCategory | "Other"; items: CommandItem[] }> {
  const map = new Map<string, CommandItem[]>();
  for (const cmd of items) {
    const key = cmd.category ?? "Other";
    const bucket = map.get(key) ?? [];
    bucket.push(cmd);
    map.set(key, bucket);
  }
  const groups: Array<{ category: CommandCategory | "Other"; items: CommandItem[] }> = [];
  for (const cat of CATEGORY_ORDER) {
    const bucket = map.get(cat);
    if (bucket) groups.push({ category: cat, items: bucket });
  }
  const other = map.get("Other");
  if (other) groups.push({ category: "Other", items: other });
  return groups;
}

export function CommandPalette({ visible, onClose, commands }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentCommands());

  useEffect(() => {
    if (visible) {
      setQuery("");
      setRecentIds(loadRecentCommands());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  const commandsById = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  const groups = useMemo(() => groupByCategory(commands), [commands]);
  const recentCommands = useMemo(
    () => recentIds.map((id) => commandsById.get(id)).filter((x): x is CommandItem => !!x),
    [recentIds, commandsById],
  );
  const showRecent = query.trim().length === 0 && recentCommands.length > 0;

  const runCommand = (cmd: CommandItem) => {
    setRecentIds(recordRecentCommand(cmd.id));
    cmd.action();
    onClose();
  };

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnimatePresence>
        {visible && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className={styles.palette}
                initial={{ opacity: 0, y: -20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
                <Command label="Command palette" loop shouldFilter>
                  <Command.Input
                    ref={inputRef}
                    className={styles.input}
                    placeholder="Type a command..."
                    value={query}
                    onValueChange={setQuery}
                  />
                  <Command.List className={styles.list}>
                    <Command.Empty className={styles.empty}>
                      <div className={styles.emptyTitle}>No matching commands</div>
                      <div className={styles.emptyHint}>Try a different keyword — or press Esc to close</div>
                    </Command.Empty>

                    {showRecent && (
                      <Command.Group heading="Recent" className={styles.group}>
                        {recentCommands.map((cmd) => (
                          <CommandRow key={`recent-${cmd.id}`} cmd={cmd} onRun={runCommand} />
                        ))}
                      </Command.Group>
                    )}

                    {groups.map(({ category, items }) => (
                      <Command.Group key={category} heading={category} className={styles.group}>
                        {items.map((cmd) => (
                          <CommandRow key={cmd.id} cmd={cmd} onRun={runCommand} />
                        ))}
                      </Command.Group>
                    ))}
                  </Command.List>
                </Command>
                <div className={styles.footer}>
                  <span>
                    <kbd>↑↓</kbd> navigate
                  </span>
                  <span>
                    <kbd>Enter</kbd> run
                  </span>
                  <span>
                    <kbd>Esc</kbd> close
                  </span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface CommandRowProps {
  cmd: CommandItem;
  onRun: (cmd: CommandItem) => void;
}

function CommandRow({ cmd, onRun }: CommandRowProps) {
  const Icon = cmd.icon;
  const keywordString = cmd.keywords?.join(" ") ?? "";
  const value = `${cmd.label} ${cmd.category ?? ""} ${keywordString}`.trim();
  return (
    <Command.Item value={value} className={styles.item} onSelect={() => onRun(cmd)}>
      <span className={styles.itemIcon}>
        {Icon ? <Icon size={14} /> : <ChevronRight size={12} className={styles.itemFallbackIcon} />}
      </span>
      <span className={styles.itemLabel}>
        <span className={styles.itemTitle}>{cmd.label}</span>
        {cmd.description && <span className={styles.itemDescription}>{cmd.description}</span>}
      </span>
      {cmd.shortcut && <span className={styles.shortcut}>{cmd.shortcut}</span>}
    </Command.Item>
  );
}
