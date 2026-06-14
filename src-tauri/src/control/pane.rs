use crate::control::ControlResult;
use crate::pty::PaneRegistry;

pub fn resolve_targets(registry: &PaneRegistry, target: &str) -> ControlResult<Vec<String>> {
    registry.resolve_send_target(target)
}

pub fn rename(registry: &PaneRegistry, terminal_id: &str, name: &str) -> ControlResult<()> {
    registry.rename(terminal_id, name)
}

pub fn set_role(registry: &PaneRegistry, terminal_id: &str, role: &str) -> ControlResult<()> {
    registry.set_role(terminal_id, role)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_targets_through_pane_registry() {
        let registry = PaneRegistry::new();
        registry.register("pane-1", "powershell", "C:/repo");
        rename(&registry, "pane-1", "build").unwrap();
        set_role(&registry, "pane-1", "worker").unwrap();

        assert_eq!(resolve_targets(&registry, "build").unwrap(), vec!["pane-1"]);
        assert_eq!(
            resolve_targets(&registry, "@worker").unwrap(),
            vec!["pane-1"]
        );
    }
}
