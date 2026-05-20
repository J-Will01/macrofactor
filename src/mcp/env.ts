import { existsSync, readFileSync } from 'node:fs';

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }

  const unquoted = trimmed.slice(1, -1);
  if (quote === "'") {
    return unquoted;
  }

  return unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

export function loadEnvFile(path = process.env.MACROFACTOR_MCP_ENV_FILE ?? '.env'): void {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripOptionalQuotes(assignment.slice(separatorIndex + 1));
  }
}
