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
    assert!(g.authorize("operator", "aelyris.spawn_agent").is_allowed());
    assert!(g
        .authorize("anyone", "aelyris.orchestrator.step")
        .is_allowed());
}

#[test]
fn default_is_single_tenant() {
    let g = Governance::new();
    assert_eq!(g.tenant_of("operator"), DEFAULT_TENANT);
    assert_eq!(g.tenant_of("someone-else"), DEFAULT_TENANT);
}

#[test]
fn default_principal_and_resolver_are_the_operator() {
    let p = Principal::default();
    assert_eq!(p.actor, DEFAULT_ACTOR);
    assert_eq!(p.tenant, DEFAULT_TENANT);
    assert!(p.roles.is_empty());

    // The default resolver returns the operator for any verified token (E1).
    let g = Governance::new();
    assert_eq!(g.resolve_principal("any-token").actor, DEFAULT_ACTOR);
    assert_eq!(g.resolve_principal("").actor, DEFAULT_ACTOR);
}

#[test]
fn a_denying_policy_blocks_only_its_verb() {
    let g = Governance::with_access(Box::new(DenyVerb("aelyris.spawn_agent")));
    match g.authorize("operator", "aelyris.spawn_agent") {
        AccessDecision::Deny(reason) => assert!(reason.contains("not allowed")),
        AccessDecision::Allow => panic!("denying policy must deny its verb"),
    }
    // Every other verb still flows — swapping the policy changes the decision,
    // not the single choke point.
    assert!(g.authorize("operator", "aelyris.event.recent").is_allowed());
}
