# Aelyris Native Editor Specification

Status: high-priority queued proposal
Purpose: Monaco/WebView anchorを段階的に除去する。
Principle: Monaco全機能クローンではなく、Aelyris core workflowに必要な編集・レビュー能力をnativeで証明する。

Repository adaptation: document save, conflict state, and recovery records
extend the canonical file/control and existing persistence/migration owners.
`RecoveryJournal` below is a bounded schema within those owners, not a new
independent journal or source of truth.

---

## 1. Why editor is separate

Editorは mutable text、undo/redo、selection、syntax、LSP、file conflict、IME、large files、diff/review、accessibility text rangesを背負う。Terminalと同じphaseへ詰め込むとnative cockpit全体が完成しない。E0-E3で独立昇格する。

---

## 2. Claim levels

### E0 Legacy compatibility

- native shellからlegacy editorを開く
- path/line/column/contextを渡す
- compatibility badge
- N1/N2をブロックしない

### E1 Native source/diff viewer

- read-only source
- syntax color
- line numbers
- selection/copy/find
- diagnostics/diff/review anchor
- go-to-location
- virtualized large files

E1でreview/merge core flowをWebViewなしにする。

### E2 Native core editor

- insert/delete
- undo/redo
- multi-selection
- IME
- save
- Tree-sitter
- LSP core
- external conflict
- recovery journal

### E3 Advanced editor

- rename/code action polish
- merge editor
- advanced multi-cursor
- semantic tokens/inlay/folding
- optional minimap
- plugin story separate

---

## 3. Document model

```rust
pub struct TextDocument {
    pub id: DocumentId,
    pub path: PathBuf,
    pub text: Rope,
    pub line_index: LineIndex,
    pub revision: DocumentRevision,
    pub saved_revision: DocumentRevision,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub language: LanguageId,
    pub selections: SelectionSet,
    pub undo: UndoHistory,
    pub external: ExternalFileState,
}
```

Rope implementation is selected only after real fixture benchmark。

### 3.1 Position types

Do not mix:

- byte offset
- Unicode scalar
- UTF-16 LSP offset
- grapheme index
- line/column
- visual column

Explicit conversion API and cached line index are mandatory。

### 3.2 Transactions

```rust
pub struct EditTransaction {
    pub id: TransactionId,
    pub base_revision: DocumentRevision,
    pub edits: Vec<TextEdit>,
    pub selection_before: SelectionSet,
    pub selection_after: SelectionSet,
    pub source: EditSource,
    pub timestamp: Instant,
}
```

All modifications, including IME、paste、completion、code action、format, go through transaction。

### 3.3 Undo

- typing merge rules
- IME commit is one logical transaction
- multi-cursor atomic
- save keeps history
- external reload creates boundary
- memory budget

---

## 4. Selection and movement

```rust
pub struct Selection {
    pub anchor: TextPoint,
    pub head: TextPoint,
    pub affinity: Affinity,
}
```

- grapheme-aware left/right
- word/line/document
- visual line with wrap
- configurable home/end
- multi-selection normalization
- pointer hit-test from shaped clusters

---

## 5. Rendering

`EditorSurface` owns visible range、overscan、scroll、line layout cache、glyphs、gutter、selection/cursor、diagnostics、diff、IME。No UiNode per line/glyph。

Line cache key:

```text
document revision
line
wrap width
font/style
tab size
DPI
syntax spans
decorations
```

Layers:

1. background
2. current line/diff
3. selection
4. glyphs
5. diagnostics
6. search
7. cursors
8. IME preedit
9. hover/completion overlay

---

## 6. Syntax

Use existing Tree-sitter parsers where available。

- incremental edit
- parse worker
- revision-bound result
- stale result discarded
- highlight query
- parser failure → plain text

Parser callbacks never run on render thread。

---

## 7. LSP

Reuse existing LSP manager/control owner。Editor is projection/client。

Required E2:

- diagnostics
- hover
- completion
- definition
- references
- document symbols
- code actions
- formatting depending language

Rules:

- request carries document revision
- cancellation on newer request
- stale response ignored
- UTF-16 mapping tested
- server crash recovery
- no UI-owned LSP process

---

## 8. IME

```rust
pub struct CompositionState {
    pub range: TextRange,
    pub preedit: String,
    pub cursor_utf16: usize,
    pub clauses: Vec<CompositionClause>,
}
```

- preedit is visual, not committed document text
- result string creates exactly one transaction
- candidate caret at actual visual cursor
- composition with multi-cursor follows defined primary-cursor policy
- undo removes whole commit
- Japanese candidate manual gate

---

## 9. File I/O and safety

### Open

- detect encoding/BOM
- preserve newline
- size threshold
- binary detection
- structured error

### Save

```text
Editor SaveIntent
→ expected disk revision/hash
→ governance/path containment
→ atomic temp write + replace
→ event/projection
```

No direct `std::fs::write` from widget。

### External change

- clean → reload policy
- dirty → conflict
- diff/keep/reload/merge
- never silent overwrite

### Recovery

Journal stores path、base hash、transactions、last durable revision、timestamp。Secret policy applies。

---

## 10. Diff/review mode

- unified/split
- intraline spans
- collapsed unchanged
- hunk navigation
- comments/decisions
- ownership/proof badges
- exact commit/revision
- binary/large fallback
- keyboard actions

Review decision goes through Control Kernel。

---

## 11. Completion/hover UI

Generic overlay anchored to editor coordinates。

- virtualized completion list
- documentation panel
- keyboard navigation
- logical focus stays editor
- IME behavior defined
- stale request discarded

---

## 12. Accessibility

E1:

- editor role/name/current file/current line
- focus/selection announcement

E2/E3:

- UIA TextPattern/TextRange
- visible ranges
- caret/selection
- line navigation
- throttled text changed events

Custom UIA provider is allowed if AccessKit cannot express required text semantics。

---

## 13. Large file mode

Threshold based on bytes、lines、long-line length。

Degrade:

- no full parse
- no semantic tokens
- bounded highlighting
- chunked line index
- simplified wrap
- no minimap
- streaming search

Must remain responsive and clearly show degraded mode。

---

## 14. Keymap

All editor commands register in Rust command registry。Context conditions、conflict detection、overrides、palette/helpを統合。Vim mode is a separate value hypothesis, not default N3 blocker。

---

## 15. Verification

- property/random edit tests
- Unicode/grapheme/UTF-16 fixtures
- undo/redo reference model
- incremental vs full parse
- stale LSP
- IME exact-once
- save CAS/conflict
- recovery journal
- 1M-line file
- visual/keyboard/a11y
- diff exact commit binding

---

## 16. Monaco removal gate

Monaco/Tauri editor may be removed only when:

- E2 acceptance passes
- representative Rust/TS/Markdown/config user jobs pass
- native diff/review complete
- IME/a11y/save/recovery/large-file gates pass
- no core workflow calls legacy editor
- rollback build exists

Unused advanced Monaco features do not block removal。
