export interface ReleaseDoctorCliArgs {
  projectPath: string;
  json: boolean;
  failOnBlocker: boolean;
  help: boolean;
}

export const RELEASE_DOCTOR_USAGE = [
  'Usage: mimi-seed-release-doctor [project-path] [options]',
  '',
  'Options:',
  '  --json             Print the machine-readable report',
  '  --fail-on-blocker  Exit with status 1 when a blocker is found',
  '  -h, --help         Show this help',
].join('\n');

export function parseReleaseDoctorArgs(
  argv: string[],
  defaultProjectPath = process.cwd(),
): ReleaseDoctorCliArgs {
  let projectPath = defaultProjectPath;
  let projectPathExplicit = false;
  let json = false;
  let failOnBlocker = false;
  let help = false;

  for (const token of argv) {
    if (token === '--json') json = true;
    else if (token === '--fail-on-blocker') failOnBlocker = true;
    else if (token === '--help' || token === '-h') help = true;
    else if (token.startsWith('-')) throw new Error(`Unknown option: ${token}`);
    else if (projectPathExplicit) throw new Error(`Only one project path is allowed; received: ${token}`);
    else {
      projectPath = token;
      projectPathExplicit = true;
    }
  }

  return { projectPath, json, failOnBlocker, help };
}
