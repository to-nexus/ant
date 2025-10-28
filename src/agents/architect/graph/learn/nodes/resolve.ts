import * as fs from "fs";
import * as path from "path";
import { LearnGraphState } from "../state";

function extractPaths(spec: string): string[] {
  const re = /(?:^|\s)(\/{1}[^\s]+|\.?\/?[^\s]+\.[a-zA-Z0-9]+)(?=\s|$)/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) !== null) {
    paths.push(m[1]);
  }
  return Array.from(new Set(paths));
}

export async function resolve(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const base = state.context.workingDir;
  const targets = extractPaths(state.spec);
  const texts: string[] = [];

  if (targets.length) {
    for (const t of targets) {
      const abs = path.isAbsolute(t) ? t : path.join(base, t);
      if (fs.existsSync(abs)) {
        const stat = fs.statSync(abs);
        if (stat.isFile()) {
          texts.push(fs.readFileSync(abs, "utf8"));
        } else if (stat.isDirectory()) {
          const files = fs.readdirSync(abs, { withFileTypes: true });
          for (const f of files) {
            if (f.isFile()) {
              const p = path.join(abs, f.name);
              texts.push(fs.readFileSync(p, "utf8"));
            }
          }
        }
      }
    }
  }

  if (!texts.length) {
    texts.push(state.spec);
  }

  return { targets, texts };
}
