# Workflow YAML Specification

Workflows are defined in `.aether/workflows/*.yaml` within your project.

## Structure

```yaml
name: Feature Implementation
description: Plan, implement, and review a feature

phases:
  - name: plan
    agent:
      model: opus          # claude model (opus/sonnet/haiku)
      prompt: "Create an implementation plan for {task_title}"
      max_cost: 0.5        # USD budget limit
      timeout_secs: 600    # default: 600
      allowed_tools: []    # empty = all tools
    quality_gate:
      type: human_review   # gate before next phase

  - name: implement
    depends_on: [plan]
    agent:
      model: sonnet
      prompt: "Implement based on the plan (TDD approach)"
      max_cost: 2.0
    quality_gate:
      type: test_pass

  - name: review
    depends_on: [implement]
    agent:
      model: opus
      prompt: "Review the implementation"
      max_cost: 0.5
      quality_gate:
        type: human_review
```

## Fields

### Top Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Workflow display name |
| description | string | yes | Brief description |
| phases | Phase[] | yes | Ordered list of phases |

### Phase

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | yes | - | Phase identifier (snake_case) |
| depends_on | string[] | no | [] | Phase names that must complete first |
| agent | AgentConfig | yes | - | Agent configuration |
| quality_gate | QualityGate | no | null | Gate before next phase |

### AgentConfig

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| model | string | no | sonnet | AI model (opus/sonnet/haiku) |
| prompt | string | yes | - | Agent instruction. `{task_title}` is replaced at runtime |
| max_cost | float | no | 2.0 | USD budget limit for this phase |
| timeout_secs | int | no | 600 | Timeout in seconds |
| allowed_tools | string[] | no | [] | Tool whitelist (empty = all) |

### QualityGate

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | GateType | yes | Gate type |
| criteria | string | no | Custom criteria description |

### GateType

| Value | Description |
|-------|-------------|
| test_pass | Auto-advance if tests pass |
| build_success | Auto-advance if build succeeds |
| human_review | Wait for manual approval |
| agent_review | Another agent reviews |
| custom | Custom criteria |

## Built-in Templates

| Template | Phases |
|----------|--------|
| Feature | plan -> implement -> review |
| Bug Fix | reproduce -> fix -> verify |
| Refactoring | analyze -> refactor -> test -> review |
| Code Review | scan -> review -> report |

## Runtime

Workflows are started via the Workflow Panel (right sidebar) or programmatically.
Each phase spawns an AI agent session. Progress is tracked in real-time with
cost accumulation and status updates via Tauri events.
