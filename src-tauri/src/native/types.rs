//! Shared types for the native terminal.

use crate::agent::interactive::AgentCli;
use crate::agent::output_monitor::DetectedStatus;
use crate::ui::editor::EditorState;
use crate::ui::helm::HelmState;
use crate::ui::kanban::KanbanState;
use crate::ui::search::SearchState;
use crate::ui::welcome::WelcomeState;

/// What occupies the main content area.
pub enum ContentPane {
    Terminal,
    Editor(EditorState),
    Kanban(KanbanState),
    Search(SearchState),
    Welcome(WelcomeState),
    Helm(HelmState),
}

/// Agent status for display.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentStatus {
    Idle,
    Thinking,
    Coding,
    Waiting,
    Done,
}

impl AgentStatus {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::Thinking => "Thinking...",
            Self::Coding => "Coding",
            Self::Waiting => "Needs Input",
            Self::Done => "Done",
        }
    }

    pub fn color(&self) -> [f32; 4] {
        match self {
            Self::Idle => [0.29, 0.87, 0.50, 1.0],
            Self::Thinking => [0.98, 0.75, 0.15, 1.0],
            Self::Coding => [0.65, 0.89, 0.63, 1.0],
            Self::Waiting => [0.95, 0.55, 0.66, 1.0],
            Self::Done => [0.54, 0.71, 0.98, 1.0],
        }
    }

    pub fn from_detected(d: &DetectedStatus) -> Self {
        match d {
            DetectedStatus::Thinking => Self::Thinking,
            DetectedStatus::Coding => Self::Coding,
            DetectedStatus::Idle => Self::Idle,
            DetectedStatus::Done => Self::Done,
            DetectedStatus::WaitingPermission => Self::Waiting,
            DetectedStatus::Unknown => Self::Idle,
        }
    }
}

/// Per-tab agent metadata (None for regular terminal tabs).
#[derive(Debug, Clone)]
pub struct AgentTabInfo {
    pub cli: AgentCli,
    pub status: AgentStatus,
    pub model: String,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: std::time::Instant,
}

/// Status update from agent output monitor thread.
/// Uses PTY ID (not index) for stable identification across tab removals.
pub enum AgentUpdate {
    Status(String, AgentStatus),
    Usage(String, f64, u64),
}

/// Divider drag tracking state.
pub struct DividerDrag {
    pub dir: super::panes::SplitDir,
    pub start_pos: f32,
    pub content_size: f32,
}
