//! Governance — the enterprise contract layer (Runtime Hardening P5).
//!
//! A single, swappable authorization + tenancy choke point over the **MCP verb
//! surface** (the programmatic/agent-facing API). The Core stays local-first:
//! the DEFAULT policy allows every verb and maps everyone to one tenant, so
//! behaviour is unchanged. But because every MCP verb flows through
//! `Governance::authorize` (`api::mcp::tools_call`), an enterprise deployment can
//! enforce RBAC / capability policy by dropping in a different `AccessControl`
//! (and `TenantResolver`) — WITHOUT touching a single verb handler. This is
//! "contract wired, implementation deferred": the seam exists and is exercised.
//!
//! ## Scope & boundaries (deliberately NOT over-claimed)
//! - Covers the **MCP verb surface only**. The REST session API (`/sessions`,
//!   `/commands`, input/capture), the WebSocket stream, and the mux routes are a
//!   SEPARATE external surface that this choke point does NOT gate. A full RBAC
//!   rollout must also gate those (e.g. an axum `route_layer`). Today this is
//!   moot: auth is single-token/single-user, so authn == authz and nothing is
//!   unprotected — it only matters once multi-user auth exists.
//! - `authorize(actor, verb)` is wired to receive an actor, but the actor is
//!   currently a fixed `"operator"`: the single-token auth model has no identity
//!   to resolve. Per-actor RBAC and multi-tenant isolation therefore need
//!   multi-user auth first. The trait shape is correct; only the actor source is
//!   pending. So: per-VERB policy is enforceable now; per-ACTOR is not yet.
//! - The heavyweight backend (RBAC store, SSO, multi-node, full-call audit) is a
//!   separate productization, explicitly out of this codebase's local-first scope.

#[cfg(test)]
mod tests;

/// The verdict for one authorization check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessDecision {
    Allow,
    /// Denied, with a human-readable reason (surfaced as 403 + audited).
    Deny(String),
}

impl AccessDecision {
    pub fn is_allowed(&self) -> bool {
        matches!(self, AccessDecision::Allow)
    }
}

/// Authorize an actor to invoke a verb. Implementations are the swappable policy
/// — the default allows everything; an enterprise build supplies an RBAC policy.
pub trait AccessControl: Send + Sync {
    fn authorize(&self, actor: &str, verb: &str) -> AccessDecision;
}

/// Resolve an actor to its tenant. Default maps everyone to one tenant.
pub trait TenantResolver: Send + Sync {
    fn tenant_of(&self, actor: &str) -> String;
}

/// Default access policy: allow every verb (single-operator local-first).
pub struct AllowAll;

impl AccessControl for AllowAll {
    fn authorize(&self, _actor: &str, _verb: &str) -> AccessDecision {
        AccessDecision::Allow
    }
}

/// Default tenancy: one tenant for everyone.
pub struct SingleTenant;

pub const DEFAULT_TENANT: &str = "default";

impl TenantResolver for SingleTenant {
    fn tenant_of(&self, _actor: &str) -> String {
        DEFAULT_TENANT.to_string()
    }
}

/// The active governance policy, held in API state. Defaults to allow-all +
/// single-tenant; swap either half for enterprise enforcement without changing
/// any call site.
pub struct Governance {
    access: Box<dyn AccessControl>,
    tenants: Box<dyn TenantResolver>,
}

impl Default for Governance {
    fn default() -> Self {
        Self {
            access: Box::new(AllowAll),
            tenants: Box::new(SingleTenant),
        }
    }
}

impl Governance {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build with an explicit access policy (enterprise / tests). Tenancy stays
    /// single-tenant; use [`with_access_and_tenants`] to swap both halves.
    pub fn with_access(access: Box<dyn AccessControl>) -> Self {
        Self {
            access,
            tenants: Box::new(SingleTenant),
        }
    }

    /// Build with both an explicit access policy AND tenant resolver — the full
    /// enterprise injection point (multi-tenant RBAC) without touching any
    /// handler. The default `new()` remains allow-all + single-tenant.
    pub fn with_access_and_tenants(
        access: Box<dyn AccessControl>,
        tenants: Box<dyn TenantResolver>,
    ) -> Self {
        Self { access, tenants }
    }

    /// The single authorization choke point every MCP verb flows through.
    pub fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
        self.access.authorize(actor, verb)
    }

    pub fn tenant_of(&self, actor: &str) -> String {
        self.tenants.tenant_of(actor)
    }
}
