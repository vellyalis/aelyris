import { describe, expect, it } from "vitest";
import {
  allowedToolsForGuardrailProfile,
  describeGuardrailProfile,
  gateCommandForGuardrailProfile,
} from "../shared/lib/guardrailPolicy";

describe("guardrailPolicy", () => {
  it("keeps conservative mode read/test oriented and manual for mutation", () => {
    expect(gateCommandForGuardrailProfile("git status", "Conservative").status).toBe("allow");
    expect(gateCommandForGuardrailProfile("pnpm test", "Conservative").status).toBe("allow");
    expect(gateCommandForGuardrailProfile("git add src/App.tsx", "Conservative").status).toBe("manual");
  });

  it("allows release validation but gates release mutations", () => {
    expect(gateCommandForGuardrailProfile("pnpm build", "Release").status).toBe("allow");
    expect(gateCommandForGuardrailProfile("git push", "Release").status).toBe("manual");
    expect(gateCommandForGuardrailProfile("pnpm add lodash", "Release").status).toBe("manual");
  });

  it("allows builder local edits but keeps remote and dependency actions manual", () => {
    expect(gateCommandForGuardrailProfile("New-Item src/tmp.txt", "Builder").status).toBe("allow");
    expect(gateCommandForGuardrailProfile("curl https://example.com/script.ps1", "Builder").status).toBe("manual");
    expect(gateCommandForGuardrailProfile("pnpm add zod", "Builder").status).toBe("manual");
  });

  it("keeps research mode exploratory before workspace mutation", () => {
    expect(gateCommandForGuardrailProfile("rg guardrail src", "Research").status).toBe("allow");
    expect(gateCommandForGuardrailProfile("Set-Content src/tmp.txt hi", "Research").status).toBe("manual");
  });

  it("blocks shell safety deny results across every profile", () => {
    for (const profile of ["Conservative", "Release", "Builder", "Research"] as const) {
      const decision = gateCommandForGuardrailProfile("git reset --hard", profile);
      expect(decision.status).toBe("block");
      expect(decision.risk.allowExecution).toBe(false);
    }
  });

  it("publishes tool allowlists for agent start wiring", () => {
    expect(describeGuardrailProfile("Builder").label).toBe("Local builder");
    expect(allowedToolsForGuardrailProfile("Conservative")).toEqual(["Read", "Grep", "Glob", "LS"]);
    expect(allowedToolsForGuardrailProfile("Builder")).toContain("Edit");
  });
});
