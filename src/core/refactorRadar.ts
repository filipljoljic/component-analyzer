// src/core/refactorRadar.ts
import type { ComponentInfo } from "./componentInfo";

export type RefactorSeverity = "none" | "warning" | "critical";

export interface RefactorSignal {
  reason: string; // short tag, e.g. "large-loc"
  details: string; // human-readable, e.g. "359 LOC"
}

export interface RefactorScore {
  severity: RefactorSeverity;
  signals: RefactorSignal[];
}

/**
 * Heuristic scoring for "should I refactor this component?"
 * Uses LOC, hooks count, children count and number of effects.
 */
export function scoreComponentForRefactor(info: ComponentInfo): RefactorScore {
  const signals: RefactorSignal[] = [];

  // 1) LOC thresholds
  if (info.loc >= 350) {
    signals.push({
      reason: "large-loc",
      details: `Very large component (${info.loc} LOC)`,
    });
  } else if (info.loc >= 200) {
    signals.push({
      reason: "medium-loc",
      details: `Big component (${info.loc} LOC)`,
    });
  }

  // 2) Hooks thresholds
  const hooksCount = info.hooks?.length ?? 0;
  if (hooksCount >= 15) {
    signals.push({
      reason: "many-hooks",
      details: `Uses many hooks (${hooksCount})`,
    });
  } else if (hooksCount >= 8) {
    signals.push({
      reason: "several-hooks",
      details: `Uses several hooks (${hooksCount})`,
    });
  }

  // 3) Children thresholds
  const childrenCount = info.children?.length ?? 0;
  if (childrenCount >= 8) {
    signals.push({
      reason: "many-children",
      details: `Renders many child components (${childrenCount})`,
    });
  } else if (childrenCount >= 4) {
    signals.push({
      reason: "several-children",
      details: `Renders several child components (${childrenCount})`,
    });
  }

  // 4) Effects count
  const effectsCount = info.lineRanges?.effects?.length ?? 0;
  if (effectsCount >= 4) {
    signals.push({
      reason: "many-effects",
      details: `Has many effects (${effectsCount})`,
    });
  }

  // Compute severity
  let severity: RefactorSeverity = "none";

  const seriousReasons = signals.filter((s) =>
    ["large-loc", "many-hooks", "many-children"].includes(s.reason)
  );

  if (info.loc >= 400 || seriousReasons.length >= 2) {
    severity = "critical";
  } else if (signals.length > 0) {
    severity = "warning";
  }

  return { severity, signals };
}
