#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { resolveLang, catalog } from '#core/lang.js';
import { printJson } from './lib/cli-args.js';
import { readToolManifest } from './lib/package-root.js';
import { buildToolMenu, formatToolMenu, selectToolMenu } from './lib/tool-menu.js';
import { resolveToolsets } from './lib/toolsets.js';

const M = catalog(
  { invalid: '목록에서 고른 번호 또는 서비스 ID를 쉼표로 구분해 입력하세요.', prompt: '번호 또는 ID (예 1,2) > ' },
  { invalid: 'Enter menu numbers or service IDs separated by commas.', prompt: 'Numbers or IDs (e.g. 1,2) > ' },
);

async function main(args: string[]) {
  const lang = resolveLang();
  const help = 'mimi-seed tools [--select <areas>]';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(help);
    return;
  }
  if (args.length > 0 && (args.length !== 2 || args[0] !== '--select')) throw new Error(help);

  const manifest = readToolManifest();
  const selection = resolveToolsets(process.env, manifest);
  for (const warning of selection.warnings) console.error(warning);
  const menu = buildToolMenu(manifest, selection, lang);
  const invalid = M().invalid;

  if (args.length === 2) {
    const selected = selectToolMenu(menu, args[1]);
    if (!selected) throw new Error(invalid);
    await printJson(selected);
    return;
  }

  console.log(formatToolMenu(menu, lang));
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI) return;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  readline.setPrompt(M().prompt);
  readline.on('SIGINT', () => readline.close());
  try {
    readline.prompt();
    for await (const line of readline) {
      if (!line.trim()) return;
      const selected = selectToolMenu(menu, line);
      if (selected) {
        await printJson(selected);
        return;
      }
      console.error(invalid);
      readline.prompt();
    }
  } finally {
    readline.close();
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
