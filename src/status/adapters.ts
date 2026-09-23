export interface CommandAdapter {
  matches(command: string): boolean;
  extractFacts(command: string, output: string): string[] | undefined;
}

const adapters: CommandAdapter[] = [];

// brew cleanup
adapters.push({
  matches: (cmd) => cmd.startsWith('brew cleanup'),
  extractFacts: (cmd, output) => {
    const reclaimedMatch = output.match(/freed approximately ([\d.]+ [A-Z]+)/i) || output.match(/reclaimed ([\d.]+ [A-Z]+)/i);
    const filesRemoved = (output.match(/^Removing:/gm) || []).length;

    if (!reclaimedMatch && filesRemoved === 0) {
      if (output.trim() === '') return ['Nothing to clean'];
      return undefined;
    }

    const facts = [];
    if (filesRemoved > 0) facts.push(`Cleaned ${filesRemoved} files`);
    if (reclaimedMatch) facts.push(`reclaimed ${reclaimedMatch[1]}`);
    return facts;
  }
});

// test runners (jest/vitest/mocha/node tap)
adapters.push({
  matches: (cmd) => /\b(npm run test|npm test|pnpm test|yarn test|jest|vitest)\b/.test(cmd),
  extractFacts: (cmd, output) => {
    const jestMatch = output.match(/Tests:\s+(.*?total)/);
    if (jestMatch) {
      const summary = jestMatch[1].replace(/,\s*/g, ' · ');
      return [summary];
    }

    const tapPass = output.match(/^#\s+pass\s+(\d+)/m);
    const tapFail = output.match(/^#\s+fail\s+(\d+)/m);
    const tapSkipped = output.match(/^#\s+skipped\s+(\d+)/m);
    const tapTests = output.match(/^#\s+tests\s+(\d+)/m);

    if (tapTests || tapPass || tapFail) {
      const facts = [];
      const passCount = tapPass ? parseInt(tapPass[1], 10) : 0;
      const failCount = tapFail ? parseInt(tapFail[1], 10) : 0;
      const skipCount = tapSkipped ? parseInt(tapSkipped[1], 10) : 0;

      if (passCount > 0) facts.push(`${passCount} passed`);
      if (failCount > 0) facts.push(`${failCount} failed`);
      if (skipCount > 0) facts.push(`${skipCount} skipped`);

      if (facts.length > 0) return facts;
      if (tapTests) return [`${tapTests[1]} tests`];
    }

    const passing = output.match(/(\d+)\s+passing/);
    const failing = output.match(/(\d+)\s+failing/);
    if (passing || failing) {
      const facts = [];
      if (failing) facts.push(`${failing[1]} failing`);
      if (passing) facts.push(`${passing[1]} passing`);
      return facts;
    }
    return undefined;
  }
});

// npm install
adapters.push({
  matches: (cmd) => /\b(npm|pnpm|yarn)\s+(i|install|add|remove|rm|uninstall)\b/.test(cmd),
  extractFacts: (cmd, output) => {
    const addedMatch = output.match(/added (\d+) package/i);
    const removedMatch = output.match(/removed (\d+) package/i);
    const changedMatch = output.match(/changed (\d+) package/i);
    const auditedMatch = output.match(/audited (\d+) package/i);
    const vulns = output.match(/(\d+) vulnerabilities/i) || output.match(/(\d+) (low|moderate|high|critical) severity vulnerabilities/i);

    const facts = [];
    if (addedMatch) facts.push(`added ${addedMatch[1]}`);
    if (removedMatch) facts.push(`removed ${removedMatch[1]}`);
    if (changedMatch) facts.push(`changed ${changedMatch[1]}`);
    if (facts.length === 0 && auditedMatch) facts.push(`audited ${auditedMatch[1]}`);

    if (vulns) facts.push(`${vulns[1]} vulnerabilities`);

    if (facts.length === 0) return undefined;
    return facts;
  }
});

// git commit
adapters.push({
  matches: (cmd) => cmd.startsWith('git commit'),
  extractFacts: (cmd, output) => {
    const changed = output.match(/(\d+) file[s]? changed/);
    const insertions = output.match(/(\d+) insertion[s]?/);
    const deletions = output.match(/(\d+) deletion[s]?/);

    const facts = [];
    if (changed) facts.push(`${changed[1]} files changed`);
    if (insertions) facts.push(`+${insertions[1]}`);
    if (deletions) facts.push(`-${deletions[1]}`);

    if (facts.length === 0) return undefined;
    return facts;
  }
});

export function extractFacts(command: string, output: string): string[] | undefined {
  for (const adapter of adapters) {
    if (adapter.matches(command)) {
      const facts = adapter.extractFacts(command, output);
      if (facts && facts.length > 0) return facts;
    }
  }
  return undefined;
}
