use super::*;

/// A policy that denies exactly one verb — proves the choke point enforces a
/// swapped policy without any handler change.
struct DenyVerb(&'static str);

impl AccessControl for DenyVerb {
    fn authorize(&self, _actor: &str, verb: &str) -> AccessDecision {
        if verb == self.0 {
            AccessDecision::Deny(format!("{verb} not allowed for this actor"))
        } else {
            AccessDecision::Allow
        }
    }
}

#[test]
fn default_allows_every_verb() {
    let g = Governance::new();
    assert!(g.authorize("operator", "aether.spawn_agent").is_allowed());
    assert!(g
        .authorize("anyone", "aether.orchestrator.step")
        .is_allowed());
}

#[test]
fn default_is_single_tenant() {
    let g = Governance::new();
    assert_eq!(g.tenant_of("operator"), DEFAULT_TENANT);
    assert_eq!(g.tenant_of("someone-else"), DEFAULT_TENANT);
}

#[test]
fn a_denying_policy_blocks_only_its_verb() {
    let g = Governance::with_access(Box::new(DenyVerb("aether.spawn_agent")));
    match g.authorize("operator", "aether.spawn_agent") {
        AccessDecision::Deny(reason) => assert!(reason.contains("not allowed")),
        AccessDecision::Allow => panic!("denying policy must deny its verb"),
    }
    // Every other verb still flows — swapping the policy changes the decision,
    // not the single choke point.
    assert!(g.authorize("operator", "aether.event.recent").is_allowed());
}
