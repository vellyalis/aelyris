/**
 * The user-visible keyboard contract for the cockpit.
 *
 * Global handlers, command-palette hints, Settings, and Help all consume this
 * table so a shortcut cannot remain documented after its owner changes.
 * Terminal-prefix entries are resolved by the mux keymap, while entries
 * without a matcher are owned by the browser/editor surface.
 */

export interface ShortcutDefinition {
  readonly id: string;
  readonly label: string;
  readonly display: string;
  readonly match?: (event: KeyboardEvent) => boolean;
}

interface KeyMatcherOptions {
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function keyMatcher(key: string | RegExp, options: KeyMatcherOptions = {}): (event: KeyboardEvent) => boolean {
  return (event) => {
    const matchesKey = key instanceof RegExp ? key.test(event.key) : normalizeKey(event.key) === normalizeKey(key);
    if (!matchesKey) return false;
    if (options.ctrlKey !== undefined && event.ctrlKey !== options.ctrlKey) return false;
    if (options.shiftKey !== undefined && event.shiftKey !== options.shiftKey) return false;
    if (options.altKey !== undefined && event.altKey !== options.altKey) return false;
    if (options.metaKey !== undefined && event.metaKey !== options.metaKey) return false;
    return true;
  };
}

const ctrl = (key: string, shiftKey = false) => keyMatcher(key, { ctrlKey: true, shiftKey });
const ctrlShift = (key: string) => keyMatcher(key, { ctrlKey: true, shiftKey: true });

export const SHORTCUTS = {
  commandPalette: {
    id: "commandPalette",
    label: "Command Palette",
    display: "Ctrl+Shift+P",
    match: ctrlShift("p"),
  },
  quickOpen: {
    id: "quickOpen",
    label: "Quick Open",
    display: "Ctrl+P",
    match: ctrl("p"),
  },
  commandHistory: {
    id: "commandHistory",
    label: "Command History",
    display: "Ctrl+R",
    match: ctrl("r"),
  },
  help: {
    id: "help",
    label: "Help",
    display: "F1",
    match: keyMatcher("F1"),
  },
  newTerminal: {
    id: "newTerminal",
    label: "New Terminal",
    display: "Ctrl+Shift+T",
    match: ctrlShift("t"),
  },
  closeTerminalTab: {
    id: "closeTerminalTab",
    label: "Close Terminal Tab",
    display: "Ctrl+Shift+W",
    match: ctrlShift("w"),
  },
  newFile: {
    id: "newFile",
    label: "New File",
    display: "Ctrl+N",
    match: ctrl("n"),
  },
  closeEditor: {
    id: "closeEditor",
    label: "Close Editor",
    display: "Ctrl+W",
    match: ctrl("w"),
  },
  save: {
    id: "save",
    label: "Save",
    display: "Ctrl+S",
  },
  findInFile: {
    id: "findInFile",
    label: "Find in File",
    display: "Ctrl+F",
  },
  replaceInFile: {
    id: "replaceInFile",
    label: "Replace in File",
    display: "Ctrl+H",
  },
  searchFiles: {
    id: "searchFiles",
    label: "Search in Files",
    display: "Ctrl+Shift+F",
    match: ctrlShift("f"),
  },
  openFolder: {
    id: "openFolder",
    label: "Open Folder",
    display: "Ctrl+Shift+O",
    match: ctrlShift("o"),
  },
  explorerFocus: {
    id: "explorerFocus",
    label: "Explorer Focus",
    display: "Ctrl+Shift+E",
    match: ctrlShift("e"),
  },
  startAgent: {
    id: "startAgent",
    label: "Start Agent",
    display: "Ctrl+Shift+A",
    match: ctrlShift("a"),
  },
  settings: {
    id: "settings",
    label: "Settings",
    display: "Ctrl+,",
    match: ctrl(","),
  },
  toggleSidebar: {
    id: "toggleSidebar",
    label: "Toggle Sidebar",
    display: "Ctrl+B",
    match: ctrl("b"),
  },
  focusTerminal: {
    id: "focusTerminal",
    label: "Focus Terminal",
    display: "Ctrl+`",
    match: ctrl("`"),
  },
  switchTerminalPane: {
    id: "switchTerminalPane",
    label: "Switch Terminal Pane",
    display: "Ctrl+Shift+`",
    match: ctrlShift("`"),
  },
  focusNextPane: {
    id: "focusNextPane",
    label: "Focus Next Terminal Pane",
    display: "Ctrl+Shift+]",
    match: ctrlShift("]"),
  },
  focusPreviousPane: {
    id: "focusPreviousPane",
    label: "Focus Previous Terminal Pane",
    display: "Ctrl+Shift+[",
    match: ctrlShift("["),
  },
  movePaneNext: {
    id: "movePaneNext",
    label: "Move Pane Next",
    display: "Ctrl+B }",
  },
  movePanePrevious: {
    id: "movePanePrevious",
    label: "Move Pane Previous",
    display: "Ctrl+B {",
  },
  rotatePanesNext: {
    id: "rotatePanesNext",
    label: "Rotate Panes Next",
    display: "Ctrl+B o",
  },
  rotatePanesPrevious: {
    id: "rotatePanesPrevious",
    label: "Rotate Panes Previous",
    display: "Ctrl+B O",
  },
  equalizePanes: {
    id: "equalizePanes",
    label: "Equalize Pane Sizes",
    display: "Ctrl+B =",
  },
  tilePanes: {
    id: "tilePanes",
    label: "Tile Terminal Panes",
    display: "Ctrl+B Space",
  },
  splitPaneRight: {
    id: "splitPaneRight",
    label: "Split Pane Right",
    display: "Ctrl+B %",
  },
  splitPaneDown: {
    id: "splitPaneDown",
    label: "Split Pane Down",
    display: 'Ctrl+B "',
  },
  toggleZenMode: {
    id: "toggleZenMode",
    label: "Toggle Zen Mode",
    display: "Ctrl+Shift+M",
    match: ctrlShift("m"),
  },
  toggleRightRail: {
    id: "toggleRightRail",
    label: "Toggle Right Rail",
    display: "Ctrl+Shift+R",
    match: ctrlShift("r"),
  },
  openDecisionInbox: {
    id: "openDecisionInbox",
    label: "Open Decision Inbox",
    display: "Ctrl+Shift+D",
    match: ctrlShift("d"),
  },
  cycleWorkspaceRegion: {
    id: "cycleWorkspaceRegion",
    label: "Cycle Workspace Regions",
    display: "F6 / Shift+F6",
    match: keyMatcher("F6", { ctrlKey: false, altKey: false, metaKey: false }),
  },
  switchTerminalTab: {
    id: "switchTerminalTab",
    label: "Switch Terminal Tab",
    display: "Ctrl+Tab / Ctrl+Shift+Tab",
    match: keyMatcher("Tab", { ctrlKey: true }),
  },
  previousSession: {
    id: "previousSession",
    label: "Previous Session",
    display: "Ctrl+[",
    match: ctrl("["),
  },
  nextSession: {
    id: "nextSession",
    label: "Next Session",
    display: "Ctrl+]",
    match: ctrl("]"),
  },
  sessionJump: {
    id: "sessionJump",
    label: "Session Jump",
    display: "Ctrl+0-9",
    match: keyMatcher(/^[0-9]$/, { ctrlKey: true }),
  },
  undo: {
    id: "undo",
    label: "Undo",
    display: "Ctrl+Z",
  },
  redo: {
    id: "redo",
    label: "Redo",
    display: "Ctrl+Y",
  },
  cut: {
    id: "cut",
    label: "Cut",
    display: "Ctrl+X",
  },
  copy: {
    id: "copy",
    label: "Copy",
    display: "Ctrl+C",
  },
  paste: {
    id: "paste",
    label: "Paste",
    display: "Ctrl+V",
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUT_REGISTRY: readonly ShortcutDefinition[] = Object.values(SHORTCUTS);

export function shortcutFor(id: ShortcutId): string {
  return SHORTCUTS[id].display;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  return shortcut.match?.(event) ?? false;
}

export function getShortcutHelpItems(): readonly Pick<ShortcutDefinition, "id" | "label" | "display">[] {
  return SHORTCUT_REGISTRY.map(({ id, label, display }) => ({ id, label, display }));
}

export function formatShortcutForAria(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const key = part.trim();
      if (key.toLowerCase() === "ctrl") return "Control";
      if (key.toLowerCase() === "cmd") return "Meta";
      return key.length === 1 ? key.toUpperCase() : key;
    })
    .join("+");
}
