//! File Ownership — declarative path claims for parallel agents.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 8. The Planner assigns path patterns to agents (e.g.
//! `src/auth/**` -> Agent #3) so parallel lanes never write the same files;
//! overlapping claims are surfaced up front rather than discovered at merge
//! time (Design Principle 4: prefer duplication over conflict).

use serde::{Deserialize, Serialize};

/// A claim that `agent_id` owns paths matching `pattern`.
///
/// Pattern forms: exact (`src/main.rs`), direct-children glob (`src/auth/*`),
/// or recursive glob (`src/auth/**`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnershipClaim {
    pub agent_id: String,
    pub pattern: String,
}

/// Two claims by different agents whose path sets overlap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnershipConflict {
    pub agent_a: String,
    pub pattern_a: String,
    pub agent_b: String,
    pub pattern_b: String,
}

#[derive(Debug, Default)]
pub struct FileOwnership {
    claims: Vec<OwnershipClaim>,
}

impl FileOwnership {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn assign(&mut self, agent_id: impl Into<String>, pattern: impl Into<String>) {
        self.claims.push(OwnershipClaim {
            agent_id: agent_id.into(),
            pattern: pattern.into(),
        });
    }

    /// Drop the first claim matching `(agent_id, pattern)`; returns whether one
    /// was removed. Used when a task merges to free its file lane so a later
    /// task can claim the same paths without a false conflict.
    pub fn release(&mut self, agent_id: &str, pattern: &str) -> bool {
        if let Some(pos) = self
            .claims
            .iter()
            .position(|claim| claim.agent_id == agent_id && claim.pattern == pattern)
        {
            self.claims.remove(pos);
            true
        } else {
            false
        }
    }

    pub fn claims(&self) -> &[OwnershipClaim] {
        &self.claims
    }

    /// The agent owning `path` (first matching claim), if any.
    pub fn owner_of(&self, path: &str) -> Option<&str> {
        self.claims
            .iter()
            .find(|claim| pattern_matches(&claim.pattern, path))
            .map(|claim| claim.agent_id.as_str())
    }

    /// Whether `agent_id` is allowed to write `path` (it owns a matching claim).
    pub fn is_owned_by(&self, path: &str, agent_id: &str) -> bool {
        self.claims
            .iter()
            .any(|claim| claim.agent_id == agent_id && pattern_matches(&claim.pattern, path))
    }

    /// Cross-agent overlapping claims. Conservative: a pair is flagged when one
    /// claim's base path nests within (or equals) the other's, which over-flags
    /// `*` vs nested paths but never misses a real collision (BR8 errs toward
    /// caution). Same-agent overlaps are not conflicts.
    pub fn conflicts(&self) -> Vec<OwnershipConflict> {
        let mut out = Vec::new();
        for (i, a) in self.claims.iter().enumerate() {
            for b in &self.claims[i + 1..] {
                if a.agent_id == b.agent_id {
                    continue;
                }
                if patterns_overlap(&a.pattern, &b.pattern) {
                    out.push(OwnershipConflict {
                        agent_a: a.agent_id.clone(),
                        pattern_a: a.pattern.clone(),
                        agent_b: b.agent_id.clone(),
                        pattern_b: b.pattern.clone(),
                    });
                }
            }
        }
        out
    }
}

/// Does `pattern` match `path`?
fn pattern_matches(pattern: &str, path: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix("/**") {
        // Recursive: the directory itself or any descendant.
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if let Some(prefix) = pattern.strip_suffix("/*") {
        // Direct children only: prefix + "/" + exactly one more segment.
        let Some(rest) = path.strip_prefix(&format!("{prefix}/")) else {
            return false;
        };
        return !rest.is_empty() && !rest.contains('/');
    }
    pattern == path
}

/// The non-wildcard directory a pattern is anchored at: everything up to (but
/// not including) the first segment that contains a glob (`*`). So `src/auth/**`
/// and `src/auth/*` and `src/auth/*.ts` all anchor at `src/auth`, `src/*/x`
/// anchors at `src`, and a literal path anchors at itself. A leading wildcard
/// (`*.ts`) anchors at the root (`""`). This generalizes beyond the documented
/// `/**` `/*` suffix forms so the overlap check stays conservative for ANY glob
/// a lane might declare (it never under-anchors, so it never misses a collision).
fn pattern_base(pattern: &str) -> &str {
    match pattern.find('*') {
        None => pattern,
        Some(star) => match pattern[..star].rfind('/') {
            Some(slash) => &pattern[..slash],
            None => "",
        },
    }
}

/// Whether two path patterns can match a common path (one anchor nests in the
/// other). The single source of truth for "do these two lanes collide" — used
/// both by `conflicts()` (detection) and the autonomy loop's conflict-aware
/// dispatch (enforcement: never co-dispatch two tasks whose output lanes
/// overlap). Conservative by design: it compares the patterns' non-wildcard
/// anchors, so it over-flags (e.g. `src/auth/*.ts` vs `src/auth/*.css` are
/// flagged though no file is shared) but never misses a real collision for any
/// glob form — BR8 errs toward caution (prefer serializing over a write race).
pub fn patterns_overlap(a: &str, b: &str) -> bool {
    let (base_a, base_b) = (pattern_base(a), pattern_base(b));
    base_a == base_b || is_path_prefix(base_a, base_b) || is_path_prefix(base_b, base_a)
}

/// Is `prefix` a path-prefix of `path` (the empty/root prefix nests everything,
/// equal, or `path` is under `prefix/`)?
fn is_path_prefix(prefix: &str, path: &str) -> bool {
    prefix.is_empty() || path == prefix || path.starts_with(&format!("{prefix}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recursive_glob_matches_descendants_and_self() {
        assert!(pattern_matches("src/auth/**", "src/auth"));
        assert!(pattern_matches("src/auth/**", "src/auth/login.ts"));
        assert!(pattern_matches("src/auth/**", "src/auth/oauth/google.ts"));
        assert!(!pattern_matches("src/auth/**", "src/db/pool.ts"));
    }

    #[test]
    fn direct_child_glob_excludes_nested() {
        assert!(pattern_matches("src/auth/*", "src/auth/login.ts"));
        assert!(!pattern_matches("src/auth/*", "src/auth/oauth/google.ts"));
        assert!(!pattern_matches("src/auth/*", "src/auth"));
    }

    #[test]
    fn exact_pattern() {
        assert!(pattern_matches("src/main.rs", "src/main.rs"));
        assert!(!pattern_matches("src/main.rs", "src/main.rs.bak"));
    }

    #[test]
    fn owner_of_and_is_owned_by() {
        let mut own = FileOwnership::new();
        own.assign("agent-auth", "src/auth/**");
        own.assign("agent-db", "src/db/**");
        assert_eq!(own.owner_of("src/auth/login.ts"), Some("agent-auth"));
        assert_eq!(own.owner_of("src/db/pool.ts"), Some("agent-db"));
        assert_eq!(own.owner_of("src/ui/App.tsx"), None);
        assert!(own.is_owned_by("src/auth/login.ts", "agent-auth"));
        assert!(!own.is_owned_by("src/auth/login.ts", "agent-db"));
    }

    #[test]
    fn disjoint_claims_have_no_conflict() {
        let mut own = FileOwnership::new();
        own.assign("a", "src/auth/**");
        own.assign("b", "src/db/**");
        own.assign("c", "src/ui/*");
        assert!(own.conflicts().is_empty());
    }

    #[test]
    fn nested_cross_agent_claims_conflict() {
        let mut own = FileOwnership::new();
        own.assign("a", "src/**");
        own.assign("b", "src/auth/login.ts");
        let conflicts = own.conflicts();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].agent_a, "a");
        assert_eq!(conflicts[0].agent_b, "b");
    }

    #[test]
    fn same_agent_overlap_is_not_a_conflict() {
        let mut own = FileOwnership::new();
        own.assign("a", "src/**");
        own.assign("a", "src/auth/**");
        assert!(own.conflicts().is_empty());
    }

    #[test]
    fn overlap_is_conservative_for_non_suffix_globs() {
        // Beyond the documented `/**` `/*` forms, any glob anchors at its
        // non-wildcard prefix, so lanes that could touch a common file are
        // flagged (never missed) — the safety-relevant direction for the
        // dispatch gate. Disjoint directories are still not flagged.
        assert!(patterns_overlap("src/auth/*.ts", "src/auth/login.ts"));
        assert!(patterns_overlap("src/*/index.ts", "src/auth/index.ts"));
        assert!(patterns_overlap("src/auth/*.ts", "src/auth/*.css")); // over-flag (safe)
        assert!(!patterns_overlap("src/auth/*.ts", "src/db/pool.ts"));
        // A leading wildcard anchors at the root, so it conservatively contends
        // with everything rather than silently slipping the gate.
        assert!(patterns_overlap("*.ts", "src/auth/login.ts"));
    }

    #[test]
    fn release_drops_a_claim_and_frees_the_path() {
        let mut own = FileOwnership::new();
        own.assign("a", "src/auth/**");
        assert_eq!(own.owner_of("src/auth/login.ts"), Some("a"));
        assert!(own.release("a", "src/auth/**"));
        assert_eq!(own.owner_of("src/auth/login.ts"), None);
        // Releasing again is a no-op (already gone).
        assert!(!own.release("a", "src/auth/**"));
    }
}
