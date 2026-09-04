import fs from "node:fs";
import path from "node:path";
import type { JenkinsConfig } from "./jenkins-config.js";
import type { ProjectManifest } from "./project-manifest.js";
import { MANIFEST_FILENAME } from "./project-manifest.js";
import { catalog } from "./i18n.js";

const M = catalog({
  invalidManifest: "프로젝트 .mimi-seed.json은 올바른 JSON 객체여야 합니다.",
  controllerMismatch: "프로젝트 Jenkins URL과 로컬에서 인증된 컨트롤러가 다릅니다.",
  invalidJob: ".mimi-seed.json의 services.jenkins.jobAndroid/jobIos에 올바른 잡 경로를 설정하세요.",
  invalidRef: "Jenkins --ref에는 커밋 해시·표현식이 아닌 브랜치 이름을 지정하세요.",
}, {
  invalidManifest: "Project .mimi-seed.json must be a valid JSON object.",
  controllerMismatch: "Project Jenkins URL differs from the locally authenticated controller.",
  invalidJob: "Configure services.jenkins.jobAndroid/jobIos in .mimi-seed.json with a valid job path.",
  invalidRef: "Jenkins --ref must be a branch name, not a commit hash or revision expression.",
});

// Deployment must fail closed on malformed project config, unlike informational status scans.
// Never use a repository URL to redirect the user's Jenkins credentials to another host.
export function resolveProjectJenkins(
  cfg: JenkinsConfig,
  platform: "android" | "ios",
  cwd = process.cwd(),
): { job: string; source: string } {
  const field = platform === "android" ? "jobAndroid" : "jobIos";
  let dir = path.resolve(cwd);
  for (let depth = 0; depth <= 8; depth++) {
    const file = path.join(dir, MANIFEST_FILENAME);
    if (fs.existsSync(file)) {
      let manifest: ProjectManifest;
      try { manifest = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectManifest; }
      catch { throw new Error(M().invalidManifest); }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(M().invalidManifest);
      }
      const service = manifest.services?.jenkins;
      if (service?.url !== undefined && (typeof service.url !== "string" || service.url.replace(/\/+$/, "") !== cfg.url.replace(/\/+$/, ""))) {
        throw new Error(M().controllerMismatch);
      }
      // A project manifest is an isolation boundary: never inherit another project's global job.
      return { job: validateJob(service?.[field]), source: file };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { job: validateJob(cfg[field]), source: "jenkins.json" };
}

function validateJob(job: unknown): string {
  if (typeof job !== "string" || !job || job.split("/").some(part =>
    !part || part === "." || part === ".." || /[\\?#%]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
    throw new Error(M().invalidJob);
  }
  return job;
}

export function jenkinsJobPath(job: string): string {
  return validateJob(job).split("/").map(part => `job/${encodeURIComponent(part)}`).join("/");
}

export function jenkinsBuildParameters(platform: "android" | "ios", ref: string, appId?: string): Record<string, string> {
  // These jobs commit version bumps back to a branch; detached commit hashes are unsafe.
  if (!ref || /^[a-f0-9]{7,40}$/i.test(ref) || ref.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(ref)) {
    throw new Error(M().invalidRef);
  }
  return {
    BUILD_TARGET: platform,
    SRC_GIT_COMMIT: ref,
    ANDROID_PUBLISH_TO_GOOGLEPLAY: String(platform === "android"),
    IOS_UPLOAD_TO_TESTFLIGHT: String(platform === "ios"),
    ANDROID_UPLOAD_TO_WEBFILE: "false",
    IOS_UPLOAD_TO_WEBFILE: "false",
    ANNOUNCE_UPDATE_TO_USERS: "false",
    TURN_OFF_SLACK_NOTI: "true",
    ...(appId ? { MIMI_APP_ID: appId } : {}),
  };
}
