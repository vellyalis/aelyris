use serde::{Deserialize, Serialize};

/// Cost per million tokens (input, output) in USD
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input_per_m: f64,
    pub output_per_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub recommended_model: String,
    pub reasoning: String,
    pub estimated_cost: f64,
    pub fallback_model: String,
    pub task_type: String,
    pub complexity: String,
}

/// Heuristic-based task complexity
#[derive(Debug, PartialEq)]
enum Complexity {
    Simple,
    Moderate,
    Complex,
}

/// Heuristic-based task type
#[derive(Debug)]
enum TaskType {
    Read,
    CodeGen,
    Architecture,
    Review,
    Debug,
    General,
}

pub struct AgentRouter;

impl AgentRouter {
    /// Route a prompt to the best model based on heuristics
    pub fn route(prompt: &str, budget_remaining: Option<f64>) -> RoutingDecision {
        let task_type = Self::classify_task(prompt);
        let complexity = Self::estimate_complexity(prompt);

        let (model, fallback, reasoning) = match (&task_type, &complexity) {
            // Simple reads/queries → Haiku (cheapest)
            (TaskType::Read, _) => (
                "claude-haiku",
                "claude-sonnet",
                "Read-only task, using cheapest model",
            ),
            // Complex architecture/design → Opus
            (TaskType::Architecture, _) | (_, Complexity::Complex) => (
                "claude-opus",
                "claude-sonnet",
                "Complex reasoning task, using most capable model",
            ),
            // Code review → Opus for thoroughness
            (TaskType::Review, _) => (
                "claude-opus",
                "claude-sonnet",
                "Code review benefits from deep analysis",
            ),
            // Code generation → Sonnet (best balance)
            (TaskType::CodeGen, _) => (
                "claude-sonnet",
                "claude-opus",
                "Code generation task, balanced cost/quality",
            ),
            // Debug → Sonnet
            (TaskType::Debug, _) => (
                "claude-sonnet",
                "claude-opus",
                "Debugging task, balanced approach",
            ),
            // Simple general → Haiku
            (TaskType::General, Complexity::Simple) => (
                "claude-haiku",
                "claude-sonnet",
                "Simple task, using cost-effective model",
            ),
            // Moderate general → Sonnet
            (TaskType::General, _) => (
                "claude-sonnet",
                "claude-opus",
                "General task, balanced approach",
            ),
        };

        // Budget override: downgrade if budget is low
        let final_model = if let Some(budget) = budget_remaining {
            if budget < 0.5 && model == "claude-opus" {
                "claude-sonnet"
            } else if budget < 0.1 {
                "claude-haiku"
            } else {
                model
            }
        } else {
            model
        };

        let estimated_cost = Self::estimate_cost(prompt, final_model);

        RoutingDecision {
            recommended_model: final_model.to_string(),
            reasoning: reasoning.to_string(),
            estimated_cost,
            fallback_model: fallback.to_string(),
            task_type: format!("{:?}", task_type),
            complexity: format!("{:?}", complexity),
        }
    }

    fn classify_task(prompt: &str) -> TaskType {
        let lower = prompt.to_lowercase();

        // Read/query patterns
        if lower.starts_with("what ")
            || lower.starts_with("how does")
            || lower.starts_with("explain")
            || lower.starts_with("show me")
            || lower.starts_with("find ")
            || lower.starts_with("search ")
            || lower.starts_with("list ")
        {
            return TaskType::Read;
        }

        // Architecture/design
        if lower.contains("design")
            || lower.contains("architect")
            || lower.contains("refactor")
            || lower.contains("restructure")
            || lower.contains("plan")
            || lower.contains("strategy")
        {
            return TaskType::Architecture;
        }

        // Code review
        if lower.contains("review")
            || lower.contains("audit")
            || lower.contains("check ")
            || lower.contains("analyze")
        {
            return TaskType::Review;
        }

        // Debug
        if lower.contains("fix ")
            || lower.contains("debug")
            || lower.contains("bug")
            || lower.contains("error")
            || lower.contains("issue")
            || lower.contains("broken")
        {
            return TaskType::Debug;
        }

        // Code generation
        if lower.contains("implement")
            || lower.contains("create")
            || lower.contains("build")
            || lower.contains("add ")
            || lower.contains("write ")
            || lower.contains("generate")
            || lower.contains("make ")
        {
            return TaskType::CodeGen;
        }

        TaskType::General
    }

    fn estimate_complexity(prompt: &str) -> Complexity {
        let word_count = prompt.split_whitespace().count();
        let has_multi_file = prompt.to_lowercase().contains("multiple files")
            || prompt.to_lowercase().contains("across")
            || prompt.to_lowercase().contains("entire");
        let has_complex_keywords = prompt.to_lowercase().contains("complex")
            || prompt.to_lowercase().contains("comprehensive")
            || prompt.to_lowercase().contains("complete")
            || prompt.to_lowercase().contains("all ");

        if word_count > 100 || (has_multi_file && has_complex_keywords) {
            Complexity::Complex
        } else if word_count > 30 || has_multi_file || has_complex_keywords {
            Complexity::Moderate
        } else {
            Complexity::Simple
        }
    }

    fn estimate_cost(prompt: &str, model: &str) -> f64 {
        let input_tokens = (prompt.len() as f64 / 4.0).ceil();
        // Assume ~2x output tokens relative to input for generation tasks
        let est_output_tokens = input_tokens * 2.0;

        let (input_price, output_price) = match model {
            "claude-opus" => (15.0, 75.0), // per million tokens
            "claude-sonnet" => (3.0, 15.0),
            "claude-haiku" => (0.25, 1.25),
            _ => (3.0, 15.0), // default to sonnet pricing
        };

        (input_tokens * input_price + est_output_tokens * output_price) / 1_000_000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_task_routes_to_haiku() {
        let decision = AgentRouter::route("What does this function do?", None);
        assert_eq!(decision.recommended_model, "claude-haiku");
    }

    #[test]
    fn test_codegen_routes_to_sonnet() {
        let decision = AgentRouter::route("Implement a login form with validation", None);
        assert_eq!(decision.recommended_model, "claude-sonnet");
    }

    #[test]
    fn test_architecture_routes_to_opus() {
        let decision =
            AgentRouter::route("Design the database architecture for this project", None);
        assert_eq!(decision.recommended_model, "claude-opus");
    }

    #[test]
    fn test_budget_override() {
        let decision = AgentRouter::route("Design the architecture", Some(0.3));
        assert_eq!(decision.recommended_model, "claude-sonnet"); // downgraded from opus
    }

    #[test]
    fn test_very_low_budget() {
        let decision = AgentRouter::route("Implement something", Some(0.05));
        assert_eq!(decision.recommended_model, "claude-haiku");
    }
}
