#!/usr/bin/env node
import { resolveLang } from '../lib/lang.js';
import { scanReleaseDoctor } from './release-doctor.js';
import { parseReleaseDoctorArgs, RELEASE_DOCTOR_USAGE } from './release-doctor-cli-args.js';
import { renderReleaseDoctor } from './release-doctor-render.js';

async function main(): Promise<void> {
  const args = parseReleaseDoctorArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${RELEASE_DOCTOR_USAGE}\n`);
    return;
  }
  const report = await scanReleaseDoctor(args.projectPath);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderReleaseDoctor(report, resolveLang()));
  }
  if (args.failOnBlocker && report.counts.blocker > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`Release Doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
