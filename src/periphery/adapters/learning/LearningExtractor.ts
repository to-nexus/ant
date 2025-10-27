export interface LearningRule {
  id: string;
  description: string;
  match: RegExp;
  category: "prompt" | "validation" | "import" | "layout" | "error" | "type";
}

export interface ExtractedLearning {
  ruleId: string;
  evidence: string;
  metadata?: Record<string, any>;
}

export class LearningExtractor {
  constructor(private rules: LearningRule[] = []) {}

  extract(text: string): ExtractedLearning[] {
    const out: ExtractedLearning[] = [];
    for (const r of this.rules) {
      const m = text.match(r.match);
      if (m) {
        out.push({ ruleId: r.id, evidence: m[0], metadata: { groups: m.groups } });
      }
    }
    return out;
  }
}
