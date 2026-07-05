use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::prompt_marks::{PromptMark, PromptMarkKind};

const MAX_BLOCKS_PER_TERMINAL: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlockRecord {
    pub id: String,
    pub terminal_id: String,
    pub command_history_id: i64,
    pub command: String,
    pub cwd: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub command_sequence: Option<u64>,
    pub output_sequence: Option<u64>,
    pub end_sequence: Option<u64>,
    pub command_history_size: Option<u32>,
    pub output_history_size: Option<u32>,
    pub end_history_size: Option<u32>,
    pub command_screen_line: Option<u16>,
    pub output_screen_line: Option<u16>,
    pub end_screen_line: Option<u16>,
}

#[derive(Default)]
pub struct CommandBlockJournal {
    blocks: Mutex<HashMap<String, VecDeque<CommandBlockRecord>>>,
}

impl CommandBlockJournal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_command(
        &self,
        terminal_id: &str,
        command_history_id: i64,
        command: &str,
        cwd: &str,
    ) -> Option<CommandBlockRecord> {
        self.record_command_with_seed_mark(terminal_id, command_history_id, command, cwd, None)
    }

    pub fn record_command_with_seed_mark(
        &self,
        terminal_id: &str,
        command_history_id: i64,
        command: &str,
        cwd: &str,
        seed_mark: Option<PromptMark>,
    ) -> Option<CommandBlockRecord> {
        let mut guard = self.blocks.lock().ok()?;
        let terminal_blocks = guard.entry(terminal_id.to_string()).or_default();
        let mut record = CommandBlockRecord {
            id: format!("history-{command_history_id}"),
            terminal_id: terminal_id.to_string(),
            command_history_id,
            command: command.to_string(),
            cwd: cwd.to_string(),
            status: "running".to_string(),
            exit_code: None,
            command_sequence: None,
            output_sequence: None,
            end_sequence: None,
            command_history_size: None,
            output_history_size: None,
            end_history_size: None,
            command_screen_line: None,
            output_screen_line: None,
            end_screen_line: None,
        };
        if let Some(mark) = seed_mark.filter(|mark| mark.kind == PromptMarkKind::CommandStart) {
            record.command_sequence = Some(mark.sequence);
            record.command_history_size = Some(mark.history_size);
            record.command_screen_line = Some(mark.screen_line);
        }
        if terminal_blocks.len() >= MAX_BLOCKS_PER_TERMINAL {
            terminal_blocks.pop_front();
        }
        terminal_blocks.push_back(record.clone());
        Some(record)
    }

    pub fn open_command_history_id(
        &self,
        terminal_id: &str,
        command: &str,
        cwd: &str,
    ) -> Option<i64> {
        let guard = self.blocks.lock().ok()?;
        let terminal_blocks = guard.get(terminal_id)?;
        terminal_blocks
            .iter()
            .rev()
            .find(|candidate| {
                candidate.end_sequence.is_none()
                    && candidate.command == command
                    && candidate.cwd == cwd
            })
            .map(|candidate| candidate.command_history_id)
    }

    pub fn record_prompt_mark(
        &self,
        terminal_id: &str,
        mark: PromptMark,
    ) -> Option<CommandBlockRecord> {
        let mut guard = self.blocks.lock().ok()?;
        let terminal_blocks = guard.get_mut(terminal_id)?;
        let block = terminal_blocks
            .iter_mut()
            .rev()
            .find(|candidate| candidate.end_sequence.is_none())?;

        match mark.kind {
            PromptMarkKind::CommandStart => {
                if block.command_sequence.is_none() {
                    block.command_sequence = Some(mark.sequence);
                    block.command_history_size = Some(mark.history_size);
                    block.command_screen_line = Some(mark.screen_line);
                }
            }
            PromptMarkKind::OutputStart => {
                block.output_sequence = Some(mark.sequence);
                block.output_history_size = Some(mark.history_size);
                block.output_screen_line = Some(mark.screen_line);
            }
            PromptMarkKind::CommandEnd => {
                if block.command_sequence.is_none()
                    && mark.sequence == 0
                    && mark.screen_line == 0
                    && mark.history_size <= 1
                {
                    return None;
                }
                block.end_sequence = Some(mark.sequence);
                block.end_history_size = Some(mark.history_size);
                block.end_screen_line = Some(mark.screen_line);
                block.exit_code = mark.exit_code;
                block.status = match mark.exit_code {
                    Some(0) => "passed",
                    Some(_) => "failed",
                    None => "unknown",
                }
                .to_string();
            }
            PromptMarkKind::PromptStart => {}
        }

        Some(block.clone())
    }

    pub fn recent(&self, terminal_id: &str, limit: usize) -> Vec<CommandBlockRecord> {
        let Ok(guard) = self.blocks.lock() else {
            return Vec::new();
        };
        let Some(blocks) = guard.get(terminal_id) else {
            return Vec::new();
        };
        blocks
            .iter()
            .rev()
            .take(limit.min(MAX_BLOCKS_PER_TERMINAL))
            .cloned()
            .collect()
    }
}

pub fn latest_open_command_start_mark(marks: &[PromptMark]) -> Option<PromptMark> {
    let latest_command_end_sequence = marks
        .iter()
        .rev()
        .find(|mark| mark.kind == PromptMarkKind::CommandEnd)
        .map(|mark| mark.sequence);

    marks.iter().rev().copied().find(|mark| {
        mark.kind == PromptMarkKind::CommandStart
            && latest_command_end_sequence
                .map(|end_sequence| mark.sequence > end_sequence)
                .unwrap_or(true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mark(kind: PromptMarkKind, sequence: u64, exit_code: Option<i32>) -> PromptMark {
        PromptMark {
            kind,
            screen_line: sequence as u16,
            exit_code,
            sequence,
            history_size: sequence as u32 + 10,
        }
    }

    #[test]
    fn command_blocks_link_history_id_to_prompt_marks() {
        let journal = CommandBlockJournal::new();
        journal.record_command("pty-a", 42, "pnpm test", "C:/repo");
        journal.record_prompt_mark("pty-a", mark(PromptMarkKind::CommandStart, 1, None));
        journal.record_prompt_mark("pty-a", mark(PromptMarkKind::OutputStart, 2, None));
        let updated = journal
            .record_prompt_mark("pty-a", mark(PromptMarkKind::CommandEnd, 3, Some(0)))
            .expect("command block should update");

        assert_eq!(updated.id, "history-42");
        assert_eq!(updated.status, "passed");
        assert_eq!(updated.exit_code, Some(0));
        assert_eq!(updated.command_sequence, Some(1));
        assert_eq!(updated.output_sequence, Some(2));
        assert_eq!(updated.end_sequence, Some(3));
        assert_eq!(updated.end_history_size, Some(13));
        assert_eq!(journal.recent("pty-a", 5), vec![updated]);
    }

    #[test]
    fn command_blocks_seed_command_anchor_from_current_prompt_mark() {
        let journal = CommandBlockJournal::new();
        let seed = PromptMark {
            kind: PromptMarkKind::CommandStart,
            screen_line: 9,
            exit_code: None,
            sequence: 42,
            history_size: 7,
        };
        let initial = journal
            .record_command_with_seed_mark("pty-a", 42, "pnpm test", "C:/repo", Some(seed))
            .expect("command block should be recorded");

        assert_eq!(initial.command_sequence, Some(42));
        assert_eq!(initial.command_history_size, Some(7));
        assert_eq!(initial.command_screen_line, Some(9));

        let updated = journal
            .record_prompt_mark("pty-a", mark(PromptMarkKind::CommandEnd, 43, Some(0)))
            .expect("command block should close");
        assert_eq!(updated.status, "passed");
        assert_eq!(updated.command_sequence, Some(42));
        assert_eq!(updated.end_sequence, Some(43));
    }

    #[test]
    fn latest_open_command_start_ignores_closed_prompt_cycles() {
        let marks = [
            PromptMark {
                kind: PromptMarkKind::CommandStart,
                screen_line: 1,
                exit_code: None,
                sequence: 10,
                history_size: 0,
            },
            PromptMark {
                kind: PromptMarkKind::CommandEnd,
                screen_line: 2,
                exit_code: Some(0),
                sequence: 11,
                history_size: 1,
            },
            PromptMark {
                kind: PromptMarkKind::PromptStart,
                screen_line: 3,
                exit_code: None,
                sequence: 12,
                history_size: 1,
            },
            PromptMark {
                kind: PromptMarkKind::CommandStart,
                screen_line: 3,
                exit_code: None,
                sequence: 13,
                history_size: 1,
            },
        ];

        let seed = latest_open_command_start_mark(&marks).expect("open prompt should seed command");
        assert_eq!(seed.sequence, 13);

        let closed_marks = [marks[0], marks[1]];
        assert!(latest_open_command_start_mark(&closed_marks).is_none());
    }

    #[test]
    fn open_command_history_id_dedupes_only_running_matches() {
        let journal = CommandBlockJournal::new();
        journal.record_command("pty-a", 42, "pnpm test", "C:/repo");
        assert_eq!(
            journal.open_command_history_id("pty-a", "pnpm test", "C:/repo"),
            Some(42)
        );
        assert_eq!(
            journal.open_command_history_id("pty-a", "pnpm test", "C:/other"),
            None
        );

        journal.record_prompt_mark("pty-a", mark(PromptMarkKind::CommandEnd, 3, Some(0)));
        assert_eq!(
            journal.open_command_history_id("pty-a", "pnpm test", "C:/repo"),
            None
        );
    }

    #[test]
    fn command_blocks_do_not_attach_marks_without_an_open_command() {
        let journal = CommandBlockJournal::new();

        assert!(journal
            .record_prompt_mark("pty-a", mark(PromptMarkKind::CommandEnd, 1, Some(1)))
            .is_none());
        assert!(journal.recent("pty-a", 5).is_empty());
    }

    #[test]
    fn command_end_before_command_start_does_not_close_pending_command() {
        let journal = CommandBlockJournal::new();
        journal.record_command("pty-a", 7, "echo ready", "C:/repo");

        assert!(journal
            .record_prompt_mark(
                "pty-a",
                PromptMark {
                    kind: PromptMarkKind::CommandEnd,
                    screen_line: 0,
                    exit_code: Some(0),
                    sequence: 0,
                    history_size: 1,
                },
            )
            .is_none());
        let pending = journal.recent("pty-a", 1).remove(0);
        assert_eq!(pending.status, "running");
        assert_eq!(pending.end_sequence, None);

        journal.record_prompt_mark("pty-a", mark(PromptMarkKind::CommandStart, 1, None));
        let completed = journal
            .record_prompt_mark("pty-a", mark(PromptMarkKind::CommandEnd, 3, Some(0)))
            .expect("command end after command start should close the block");
        assert_eq!(completed.status, "passed");
        assert_eq!(completed.command_sequence, Some(1));
        assert_eq!(completed.end_sequence, Some(3));
    }

    #[test]
    fn command_end_without_seen_start_can_close_after_reconnect_output() {
        let journal = CommandBlockJournal::new();
        journal.record_command("pty-a", 8, "echo after reconnect", "C:/repo");

        let completed = journal
            .record_prompt_mark(
                "pty-a",
                PromptMark {
                    kind: PromptMarkKind::CommandEnd,
                    screen_line: 4,
                    exit_code: Some(0),
                    sequence: 0,
                    history_size: 2,
                },
            )
            .expect("post-output command end should close even if command start was missed");
        assert_eq!(completed.status, "passed");
        assert_eq!(completed.command_sequence, None);
        assert_eq!(completed.end_sequence, Some(0));
        assert_eq!(completed.end_screen_line, Some(4));
    }
}
