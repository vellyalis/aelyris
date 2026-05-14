//! Pure Rust keymap and prefix resolver for the mux core.
//!
//! The engine is UI-agnostic: clients feed normalized keys in and receive
//! dispatch/pass-through decisions back.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const ROOT_TABLE: &str = "root";
pub const PREFIX_TABLE: &str = "prefix";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Modifiers {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub super_key: bool,
}

impl Modifiers {
    pub const NONE: Self = Self {
        ctrl: false,
        alt: false,
        shift: false,
        super_key: false,
    };

    pub const CTRL: Self = Self {
        ctrl: true,
        alt: false,
        shift: false,
        super_key: false,
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyCode {
    Char(char),
    Enter,
    Escape,
    Backspace,
    Tab,
    Space,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Insert,
    Delete,
    Function(u8),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub code: KeyCode,
    #[serde(default)]
    pub mods: Modifiers,
}

impl Key {
    pub fn new(code: KeyCode) -> Self {
        Self {
            code,
            mods: Modifiers::NONE,
        }
    }

    pub fn char(value: char) -> Self {
        Self::new(KeyCode::Char(value))
    }

    pub fn ctrl(value: char) -> Self {
        Self {
            code: KeyCode::Char(value),
            mods: Modifiers::CTRL,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct KeySequence(pub Vec<Key>);

impl KeySequence {
    pub fn new(keys: Vec<Key>) -> Self {
        Self(keys)
    }

    pub fn single(key: Key) -> Self {
        Self(vec![key])
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn is_prefix_of(&self, other: &Self) -> bool {
        self.0.len() < other.0.len() && other.0.starts_with(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyCommand {
    pub name: String,
    #[serde(default)]
    pub args: Vec<String>,
}

impl KeyCommand {
    pub fn named(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            args: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeyAction {
    Command(KeyCommand),
    SendInput { text: String },
    EnterTable { table: String },
    PassThrough,
    NoOp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub sequence: KeySequence,
    pub action: KeyAction,
    #[serde(default)]
    pub description: Option<String>,
}

impl KeyBinding {
    pub fn new(sequence: KeySequence, action: KeyAction) -> Self {
        Self {
            sequence,
            action,
            description: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyTable {
    pub name: String,
    #[serde(default)]
    bindings: Vec<KeyBinding>,
}

impl KeyTable {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            bindings: Vec::new(),
        }
    }

    pub fn binding(&self, sequence: &KeySequence) -> Option<&KeyBinding> {
        self.bindings
            .iter()
            .find(|binding| &binding.sequence == sequence)
    }

    pub fn bindings(&self) -> impl Iterator<Item = &KeyBinding> {
        self.bindings.iter()
    }

    fn has_sequence_prefix(&self, sequence: &KeySequence) -> bool {
        self.bindings
            .iter()
            .any(|existing| sequence.is_prefix_of(&existing.sequence))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeymapError {
    EmptySequence,
    UnknownTable(String),
    Conflict(KeyConflict),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyConflict {
    Duplicate {
        table: String,
        sequence: KeySequence,
    },
    ExistingBindingIsPrefix {
        table: String,
        existing: KeySequence,
        candidate: KeySequence,
    },
    CandidateIsPrefix {
        table: String,
        candidate: KeySequence,
        existing: KeySequence,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeymapEvent {
    PrefixStarted,
    SequencePending {
        table: String,
        sequence: KeySequence,
    },
    Dispatch {
        table: String,
        sequence: KeySequence,
        action: KeyAction,
    },
    TableChanged {
        table: String,
    },
    PassThrough(Key),
    Cancelled {
        table: String,
        sequence: KeySequence,
    },
    Timeout {
        table: String,
    },
}

#[derive(Debug, Clone)]
pub struct KeymapEngine {
    tables: HashMap<String, KeyTable>,
    prefix: KeySequence,
    prefix_table: String,
    timeout: Duration,
    active_table: Option<String>,
    pending: Vec<Key>,
    table_started_at: Option<Instant>,
}

impl Default for KeymapEngine {
    fn default() -> Self {
        Self::new(
            KeySequence::single(Key::ctrl('b')),
            Duration::from_millis(1000),
        )
    }
}

impl KeymapEngine {
    pub fn new(prefix: KeySequence, timeout: Duration) -> Self {
        let mut tables = HashMap::new();
        tables.insert(ROOT_TABLE.to_string(), KeyTable::new(ROOT_TABLE));
        tables.insert(PREFIX_TABLE.to_string(), KeyTable::new(PREFIX_TABLE));

        Self {
            tables,
            prefix,
            prefix_table: PREFIX_TABLE.to_string(),
            timeout,
            active_table: None,
            pending: Vec::new(),
            table_started_at: None,
        }
    }

    pub fn tmux_like_default() -> Result<Self, KeymapError> {
        let mut engine = Self::default();
        bind_aether_prefix_defaults(&mut engine)?;
        Ok(engine)
    }

    pub fn aether_default() -> Result<Self, KeymapError> {
        let mut engine = Self::default();
        bind_aether_prefix_defaults(&mut engine)?;
        Ok(engine)
    }

    pub fn prefix_table_bindings(&self) -> Vec<KeyBinding> {
        self.table(PREFIX_TABLE)
            .map(|table| table.bindings().cloned().collect())
            .unwrap_or_default()
    }

    pub fn root_table_bindings(&self) -> Vec<KeyBinding> {
        self.table(ROOT_TABLE)
            .map(|table| table.bindings().cloned().collect())
            .unwrap_or_default()
    }

    pub fn active_table_name(&self) -> Option<&str> {
        self.active_table.as_deref()
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_prefix_armed(&self) -> bool {
        self.active_table.as_deref() == Some(self.prefix_table.as_str())
    }

    fn bind_default_command(
        &mut self,
        key: Key,
        command: impl Into<String>,
        description: impl Into<String>,
    ) -> Result<(), KeymapError> {
        self.bind(
            PREFIX_TABLE,
            KeyBinding {
                sequence: KeySequence::single(key),
                action: KeyAction::Command(KeyCommand::named(command)),
                description: Some(description.into()),
            },
        )
    }

    pub fn prefix(&self) -> &KeySequence {
        &self.prefix
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    pub fn table(&self, name: &str) -> Option<&KeyTable> {
        self.tables.get(name)
    }

    pub fn ensure_table(&mut self, name: impl Into<String>) {
        let name = name.into();
        self.tables
            .entry(name.clone())
            .or_insert_with(|| KeyTable::new(name));
    }

    pub fn set_prefix_table(&mut self, table: impl Into<String>) {
        let table = table.into();
        self.ensure_table(table.clone());
        self.prefix_table = table;
    }

    pub fn bind(&mut self, table: impl AsRef<str>, binding: KeyBinding) -> Result<(), KeymapError> {
        if binding.sequence.is_empty() {
            return Err(KeymapError::EmptySequence);
        }

        let table_name = table.as_ref();
        let table = self
            .tables
            .get_mut(table_name)
            .ok_or_else(|| KeymapError::UnknownTable(table_name.to_string()))?;

        detect_conflict(table, &binding.sequence)?;
        table.bindings.push(binding);
        Ok(())
    }

    pub fn unbind(
        &mut self,
        table: impl AsRef<str>,
        sequence: &KeySequence,
    ) -> Result<Option<KeyBinding>, KeymapError> {
        let table_name = table.as_ref();
        let table = self
            .tables
            .get_mut(table_name)
            .ok_or_else(|| KeymapError::UnknownTable(table_name.to_string()))?;
        let index = table
            .bindings
            .iter()
            .position(|binding| &binding.sequence == sequence);
        Ok(index.map(|index| table.bindings.remove(index)))
    }

    pub fn remap(
        &mut self,
        table: impl AsRef<str>,
        sequence: KeySequence,
        action: KeyAction,
    ) -> Result<Option<KeyBinding>, KeymapError> {
        let previous = self.unbind(table.as_ref(), &sequence)?;
        self.bind(table, KeyBinding::new(sequence, action))?;
        Ok(previous)
    }

    pub fn process_key(&mut self, key: Key) -> KeymapEvent {
        self.process_key_at(key, Instant::now())
    }

    pub fn process_key_at(&mut self, key: Key, now: Instant) -> KeymapEvent {
        if let Some(event) = self.expire_if_needed(now) {
            if matches!(event, KeymapEvent::Timeout { .. }) {
                return event;
            }
        }

        if self.active_table.is_none() && self.pending.is_empty() && self.prefix.0 == [key.clone()]
        {
            self.active_table = Some(self.prefix_table.clone());
            self.table_started_at = Some(now);
            return KeymapEvent::PrefixStarted;
        }

        let table_name = self
            .active_table
            .clone()
            .unwrap_or_else(|| ROOT_TABLE.to_string());
        self.pending.push(key.clone());
        self.table_started_at.get_or_insert(now);

        let sequence = KeySequence::new(self.pending.clone());
        let table = match self.tables.get(&table_name) {
            Some(table) => table,
            None => {
                self.reset();
                return KeymapEvent::PassThrough(key);
            }
        };

        if let Some(binding) = table.binding(&sequence) {
            let action = binding.action.clone();
            let event = match &action {
                KeyAction::EnterTable { table } => {
                    self.active_table = Some(table.clone());
                    self.pending.clear();
                    self.table_started_at = Some(now);
                    KeymapEvent::TableChanged {
                        table: table.clone(),
                    }
                }
                KeyAction::NoOp => {
                    self.reset();
                    KeymapEvent::Dispatch {
                        table: table_name,
                        sequence,
                        action,
                    }
                }
                _ => {
                    self.reset();
                    KeymapEvent::Dispatch {
                        table: table_name,
                        sequence,
                        action,
                    }
                }
            };
            return event;
        }

        if table.has_sequence_prefix(&sequence) {
            return KeymapEvent::SequencePending {
                table: table_name,
                sequence,
            };
        }

        self.reset();
        if table_name == ROOT_TABLE {
            KeymapEvent::PassThrough(key)
        } else {
            KeymapEvent::Cancelled {
                table: table_name,
                sequence,
            }
        }
    }

    pub fn reset(&mut self) {
        self.active_table = None;
        self.pending.clear();
        self.table_started_at = None;
    }

    fn expire_if_needed(&mut self, now: Instant) -> Option<KeymapEvent> {
        let started_at = self.table_started_at?;
        if now.duration_since(started_at) <= self.timeout {
            return None;
        }

        let table = self
            .active_table
            .clone()
            .unwrap_or_else(|| ROOT_TABLE.to_string());
        self.reset();
        Some(KeymapEvent::Timeout { table })
    }
}

fn bind_aether_prefix_defaults(engine: &mut KeymapEngine) -> Result<(), KeymapError> {
    engine.bind_default_command(Key::char('c'), "new-window", "Create a new mux window")?;
    engine.bind_default_command(
        Key::char('%'),
        "split-right",
        "Split the active pane to the right",
    )?;
    engine.bind_default_command(Key::char('"'), "split-down", "Split the active pane below")?;
    engine.bind_default_command(Key::char('x'), "close", "Close the active pane")?;
    engine.bind_default_command(Key::char('z'), "toggle-maximize", "Toggle active pane zoom")?;
    engine.bind_default_command(Key::char('n'), "focus-next", "Focus the next pane")?;
    engine.bind_default_command(Key::char('p'), "focus-previous", "Focus the previous pane")?;
    engine.bind_default_command(
        Key::char('}'),
        "move-next",
        "Swap active pane with the next pane",
    )?;
    engine.bind_default_command(
        Key::char('{'),
        "move-previous",
        "Swap active pane with the previous pane",
    )?;
    engine.bind_default_command(Key::char('o'), "rotate-next", "Rotate panes forward")?;
    engine.bind_default_command(Key::char('O'), "rotate-previous", "Rotate panes backward")?;
    engine.bind_default_command(Key::char('='), "equalize", "Equalize pane sizes")?;
    engine.bind_default_command(Key::new(KeyCode::Space), "tiled", "Apply tiled pane layout")?;
    engine.bind_default_command(
        Key::char('s'),
        "sync-panes",
        "Toggle synchronized pane input",
    )?;
    Ok(())
}

fn detect_conflict(table: &KeyTable, candidate: &KeySequence) -> Result<(), KeymapError> {
    if table
        .bindings
        .iter()
        .any(|binding| &binding.sequence == candidate)
    {
        return Err(KeymapError::Conflict(KeyConflict::Duplicate {
            table: table.name.clone(),
            sequence: candidate.clone(),
        }));
    }

    for existing in table.bindings.iter().map(|binding| &binding.sequence) {
        if existing.is_prefix_of(candidate) {
            return Err(KeymapError::Conflict(
                KeyConflict::ExistingBindingIsPrefix {
                    table: table.name.clone(),
                    existing: existing.clone(),
                    candidate: candidate.clone(),
                },
            ));
        }

        if candidate.is_prefix_of(existing) {
            return Err(KeymapError::Conflict(KeyConflict::CandidateIsPrefix {
                table: table.name.clone(),
                candidate: candidate.clone(),
                existing: existing.clone(),
            }));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(name: &str) -> KeyAction {
        KeyAction::Command(KeyCommand::named(name))
    }

    #[test]
    fn prefix_dispatches_command_from_prefix_table() {
        let mut engine = KeymapEngine::default();
        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(KeySequence::single(Key::char('c')), command("new-window")),
            )
            .unwrap();

        assert_eq!(
            engine.process_key_at(Key::ctrl('b'), Instant::now()),
            KeymapEvent::PrefixStarted
        );

        match engine.process_key_at(Key::char('c'), Instant::now()) {
            KeymapEvent::Dispatch { table, action, .. } => {
                assert_eq!(table, PREFIX_TABLE);
                assert_eq!(action, command("new-window"));
            }
            event => panic!("expected dispatch, got {event:?}"),
        }
    }

    #[test]
    fn aether_default_maps_terminal_prefix_commands() {
        let expected = [
            ('%', "split-right"),
            ('"', "split-down"),
            ('x', "close"),
            ('z', "toggle-maximize"),
            ('n', "focus-next"),
            ('p', "focus-previous"),
            ('}', "move-next"),
            ('{', "move-previous"),
            ('o', "rotate-next"),
            ('O', "rotate-previous"),
            ('=', "equalize"),
            ('s', "sync-panes"),
        ];

        for (key, command_name) in expected {
            let mut engine = KeymapEngine::aether_default().unwrap();
            assert_eq!(
                engine.process_key_at(Key::ctrl('b'), Instant::now()),
                KeymapEvent::PrefixStarted
            );
            match engine.process_key_at(Key::char(key), Instant::now()) {
                KeymapEvent::Dispatch { action, .. } => {
                    assert_eq!(action, command(command_name));
                }
                event => panic!("expected dispatch for {key:?}, got {event:?}"),
            }
        }

        let mut engine = KeymapEngine::aether_default().unwrap();
        assert_eq!(
            engine.process_key_at(Key::ctrl('b'), Instant::now()),
            KeymapEvent::PrefixStarted
        );
        match engine.process_key_at(Key::new(KeyCode::Space), Instant::now()) {
            KeymapEvent::Dispatch { action, .. } => {
                assert_eq!(action, command("tiled"));
            }
            event => panic!("expected tiled dispatch, got {event:?}"),
        }
    }

    #[test]
    fn prefix_timeout_clears_prefix_mode() {
        let mut engine = KeymapEngine::new(
            KeySequence::single(Key::ctrl('b')),
            Duration::from_millis(10),
        );
        let t0 = Instant::now();

        assert_eq!(
            engine.process_key_at(Key::ctrl('b'), t0),
            KeymapEvent::PrefixStarted
        );
        assert_eq!(
            engine.process_key_at(Key::char('c'), t0 + Duration::from_millis(11)),
            KeymapEvent::Timeout {
                table: PREFIX_TABLE.to_string()
            }
        );
        assert_eq!(
            engine.process_key_at(Key::char('c'), t0 + Duration::from_millis(12)),
            KeymapEvent::PassThrough(Key::char('c'))
        );
    }

    #[test]
    fn nested_table_dispatches_after_prefix_command_enters_table() {
        let mut engine = KeymapEngine::default();
        engine.ensure_table("resize");
        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(
                    KeySequence::single(Key::char('r')),
                    KeyAction::EnterTable {
                        table: "resize".to_string(),
                    },
                ),
            )
            .unwrap();
        engine
            .bind(
                "resize",
                KeyBinding::new(KeySequence::single(Key::char('h')), command("resize-left")),
            )
            .unwrap();

        let now = Instant::now();
        assert_eq!(
            engine.process_key_at(Key::ctrl('b'), now),
            KeymapEvent::PrefixStarted
        );
        assert_eq!(
            engine.process_key_at(Key::char('r'), now),
            KeymapEvent::TableChanged {
                table: "resize".to_string()
            }
        );

        match engine.process_key_at(Key::char('h'), now) {
            KeymapEvent::Dispatch { table, action, .. } => {
                assert_eq!(table, "resize");
                assert_eq!(action, command("resize-left"));
            }
            event => panic!("expected nested dispatch, got {event:?}"),
        }
    }

    #[test]
    fn remap_and_unbind_replace_a_binding() {
        let mut engine = KeymapEngine::default();
        let sequence = KeySequence::single(Key::char('x'));

        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(sequence.clone(), command("kill-pane")),
            )
            .unwrap();
        let previous = engine
            .remap(PREFIX_TABLE, sequence.clone(), command("confirm-kill-pane"))
            .unwrap();
        assert_eq!(previous.unwrap().action, command("kill-pane"));
        assert_eq!(
            engine
                .table(PREFIX_TABLE)
                .unwrap()
                .binding(&sequence)
                .unwrap()
                .action,
            command("confirm-kill-pane")
        );

        let removed = engine.unbind(PREFIX_TABLE, &sequence).unwrap();
        assert!(removed.is_some());
        assert!(engine
            .table(PREFIX_TABLE)
            .unwrap()
            .binding(&sequence)
            .is_none());
    }

    #[test]
    fn conflict_detection_reports_duplicate_and_prefix_collisions() {
        let mut engine = KeymapEngine::default();
        let single = KeySequence::single(Key::char('a'));
        let chord = KeySequence::new(vec![Key::char('a'), Key::char('b')]);

        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(single.clone(), command("one")),
            )
            .unwrap();
        assert!(matches!(
            engine.bind(
                PREFIX_TABLE,
                KeyBinding::new(single.clone(), command("two"))
            ),
            Err(KeymapError::Conflict(KeyConflict::Duplicate { .. }))
        ));
        assert!(matches!(
            engine.bind(
                PREFIX_TABLE,
                KeyBinding::new(chord.clone(), command("chord"))
            ),
            Err(KeymapError::Conflict(
                KeyConflict::ExistingBindingIsPrefix { .. }
            ))
        ));

        let mut engine = KeymapEngine::default();
        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(chord.clone(), command("chord")),
            )
            .unwrap();
        assert!(matches!(
            engine.bind(
                PREFIX_TABLE,
                KeyBinding::new(single.clone(), command("one"))
            ),
            Err(KeymapError::Conflict(KeyConflict::CandidateIsPrefix { .. }))
        ));
    }

    #[test]
    fn key_table_serializes_as_binding_list() {
        let mut engine = KeymapEngine::default();
        let sequence = KeySequence::single(Key::char('c'));
        engine
            .bind(
                PREFIX_TABLE,
                KeyBinding::new(sequence.clone(), command("new-window")),
            )
            .unwrap();

        let json = serde_json::to_string(engine.table(PREFIX_TABLE).unwrap()).unwrap();
        let parsed: KeyTable = serde_json::from_str(&json).unwrap();

        assert_eq!(
            parsed.binding(&sequence).unwrap().action,
            command("new-window")
        );
    }
}
