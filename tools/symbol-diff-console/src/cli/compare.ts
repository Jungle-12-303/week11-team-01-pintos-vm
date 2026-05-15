#!/usr/bin/env node
import { compareRequestSchema } from "../shared/schema";
import { compareBranches } from "../server/compare";
import { GitCommandError } from "../server/gitRepo";

type Args = Record<string, string | boolean>;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const request = compareRequestSchema.parse({
    repoPath: args.repo,
    leftRef: args.left,
    rightRef: args.right,
    targetRef: typeof args.target === "string" ? args.target : undefined
  });
  const report = await compareBranches(request);
  if (args.format && args.format !== "json") {
    throw new Error(`Unsupported format: ${args.format}`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

main().catch((error) => {
  if (error instanceof GitCommandError) {
    process.stderr.write(`${JSON.stringify({ error: error.structured }, null, 2)}\n`);
  } else {
    const err = error as Error;
    process.stderr.write(`${err.message}\n`);
  }
  process.exit(1);
});
