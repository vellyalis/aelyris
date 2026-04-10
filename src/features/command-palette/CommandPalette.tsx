import { useEffect, useRef } from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "motion/react";
import styles from "./CommandPalette.module.css";

export interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export function CommandPalette({ visible, onClose, commands }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => { if (!open) onClose(); }}>
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
                <Command label="Command palette" loop>
                  <Command.Input
                    ref={inputRef}
                    className={styles.input}
                    placeholder="Type a command..."
                  />
                  <Command.List className={styles.list}>
                    <Command.Empty className={styles.empty}>No matching commands</Command.Empty>
                    {commands.map((cmd) => (
                      <Command.Item
                        key={cmd.id}
                        value={cmd.label}
                        className={styles.item}
                        onSelect={() => {
                          cmd.action();
                          onClose();
                        }}
                      >
                        <span>{cmd.label}</span>
                        {cmd.shortcut && <span className={styles.shortcut}>{cmd.shortcut}</span>}
                      </Command.Item>
                    ))}
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
