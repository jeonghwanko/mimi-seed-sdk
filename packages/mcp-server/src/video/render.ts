import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJson, writeJsonAtomic } from './files.js';
import { loadAssets, loadProject, loadTimeline } from './project.js';
import { parseFile, renderJobSchema } from './schemas.js';
import type { VideoAsset, VideoRenderJob, VideoTimeline } from './types.js';

const execFileAsync = promisify(execFile);

function jobPath(projectDir: string, jobId: string): string {
  return path.join(path.resolve(projectDir), '.jobs', `${jobId}.json`);
}

function updateJob(projectDir: string, jobId: string, patch: Partial<VideoRenderJob>): VideoRenderJob {
  const filePath = jobPath(projectDir, jobId);
  const current = parseFile(renderJobSchema, readJson(filePath), filePath);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeJsonAtomic(filePath, next);
  return next;
}

function processAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readTail(filePath: string, maxBytes = 64 * 1024): string {
  const size = statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, length, Math.max(0, size - length));
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

function sanitizeSubtitleText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/-->/g, '→')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/{/g, '｛')
    .replace(/}/g, '｝')
    .trim();
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function formatSrt(timeline: VideoTimeline): string {
  let cursor = 0;
  const blocks: string[] = [];
  for (const scene of timeline.scenes) {
    const text = sanitizeSubtitleText(scene.onScreenText ?? '');
    const start = cursor;
    cursor += scene.durationSec;
    if (!text) continue;
    blocks.push(`${blocks.length + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${text}\n`);
  }
  return blocks.join('\n');
}

function isImage(asset: VideoAsset): boolean {
  return asset.kind === 'image';
}

export interface FfmpegPlan {
  args: string[];
  outputPath: string;
  subtitlePath?: string;
}

export function buildFfmpegPlan(
  projectDir: string,
  outputPath: string,
  jobId: string,
): FfmpegPlan {
  const dir = path.resolve(projectDir);
  const project = loadProject(dir);
  const timeline = loadTimeline(dir);
  const manifest = loadAssets(dir);
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const assets = timeline.scenes.map((scene) => {
    const asset = byId.get(scene.assetId);
    if (!asset || !asset.allowedForRendering || !existsSync(asset.path)) {
      throw new Error(`렌더링할 수 없는 장면 자산입니다: ${scene.assetId}`);
    }
    return asset;
  });

  const args: string[] = ['-nostdin', '-y'];
  timeline.scenes.forEach((scene, index) => {
    const asset = assets[index];
    if (isImage(asset)) args.push('-loop', '1');
    else args.push('-stream_loop', '-1');
    args.push('-t', String(scene.durationSec), '-i', asset.path);
  });

  let audioIndex: number | undefined;
  if (timeline.audioAssetId) {
    const audio = byId.get(timeline.audioAssetId);
    if (!audio || audio.kind !== 'audio' || !audio.allowedForRendering || !existsSync(audio.path)) {
      throw new Error(`렌더링할 수 없는 오디오 자산입니다: ${timeline.audioAssetId}`);
    }
    audioIndex = assets.length;
    args.push('-stream_loop', '-1', '-i', audio.path);
  }

  const filters: string[] = timeline.scenes.map((scene, index) => (
    `[${index}:v]scale=${project.settings.width}:${project.settings.height}:force_original_aspect_ratio=increase,` +
    `crop=${project.settings.width}:${project.settings.height},fps=${project.settings.fps},` +
    `trim=duration=${scene.durationSec},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
  ));
  filters.push(`${timeline.scenes.map((_, index) => `[v${index}]`).join('')}concat=n=${timeline.scenes.length}:v=1:a=0[base]`);

  const srt = formatSrt(timeline);
  let videoLabel = '[base]';
  let subtitlePath: string | undefined;
  if (srt) {
    const relativeSubtitlePath = `render/captions-${jobId}.srt`;
    subtitlePath = path.join(dir, relativeSubtitlePath);
    writeFileSync(subtitlePath, srt, 'utf8');
    filters.push(
      `[base]subtitles=${relativeSubtitlePath}:force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=48'[vout]`,
    );
    videoLabel = '[vout]';
  }

  args.push('-filter_complex', filters.join(';'), '-map', videoLabel);
  if (audioIndex !== undefined) {
    args.push('-map', `${audioIndex}:a:0`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  args.push(
    '-t', String(timeline.totalDurationSec),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  );
  return { args, outputPath, subtitlePath };
}

async function verifyExecutable(command: string): Promise<void> {
  try {
    await execFileAsync(command, ['-version'], { timeout: 10_000, windowsHide: true });
  } catch (error) {
    throw new Error(`FFmpeg를 실행할 수 없습니다: ${command}\nFFmpeg를 설치하거나 ffmpegPath를 지정하세요.`, { cause: error });
  }
}

export interface StartRenderInput {
  projectDir: string;
  outputFileName?: string;
  ffmpegPath?: string;
  overwriteOutput?: boolean;
}

function acquireOutputLock(lockPath: string, projectDir: string, jobId: string): void {
  const tryCreate = () => {
    const fd = openSync(lockPath, 'wx');
    try {
      writeFileSync(fd, jobId, 'utf8');
    } finally {
      closeSync(fd);
    }
  };
  try {
    tryCreate();
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  let active = false;
  try {
    const existingId = readFileSync(lockPath, 'utf8').trim();
    const existingPath = jobPath(projectDir, existingId);
    if (existsSync(existingPath)) {
      const existing = parseFile(renderJobSchema, readJson(existingPath), existingPath);
      const queuedRecently = existing.status === 'queued' && Date.now() - Date.parse(existing.updatedAt) < 60_000;
      active = queuedRecently || (existing.status === 'running' && processAlive(existing.pid));
    }
  } catch {
    active = false;
  }
  if (active) throw new Error(`같은 출력 파일의 렌더 작업이 이미 실행 중입니다: ${lockPath}`);
  unlinkSync(lockPath);
  tryCreate();
}

export async function startRender(input: StartRenderInput): Promise<VideoRenderJob> {
  const projectDir = path.resolve(input.projectDir);
  loadProject(projectDir);
  loadTimeline(projectDir);
  const ffmpeg = input.ffmpegPath ?? process.env.MIMI_SEED_FFMPEG_PATH ?? 'ffmpeg';
  await verifyExecutable(ffmpeg);

  const safeOutputName = (input.outputFileName ?? 'output.mp4')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'output.mp4';
  const finalName = safeOutputName.toLowerCase().endsWith('.mp4') ? safeOutputName : `${safeOutputName}.mp4`;
  const outputPath = path.join(projectDir, 'render', finalName);
  if (existsSync(outputPath) && !input.overwriteOutput) {
    throw new Error(`출력 파일이 이미 존재합니다: ${outputPath}\noverwriteOutput=true로 명시해야 덮어씁니다.`);
  }
  const id = randomUUID();
  const logPath = path.join(projectDir, '.jobs', `${id}.log`);
  const lockPath = `${outputPath}.render.lock`;
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const plan = buildFfmpegPlan(projectDir, outputPath, id);
  const now = new Date().toISOString();
  const job: VideoRenderJob = {
    id,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    projectDir,
    outputPath,
    logPath,
  };
  writeJsonAtomic(jobPath(projectDir, id), job);
  try {
    acquireOutputLock(lockPath, projectDir, id);
  } catch (error) {
    updateJob(projectDir, id, { status: 'failed', error: (error as Error).message });
    throw error;
  }

  const logStream = createWriteStream(logPath, { flags: 'a' });
  let child;
  try {
    child = spawn(ffmpeg, plan.args, {
      cwd: projectDir,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    logStream.end();
    unlinkSync(lockPath);
    updateJob(projectDir, id, { status: 'failed', error: (error as Error).message });
    throw error;
  }
  child.stderr?.pipe(logStream);
  updateJob(projectDir, id, { status: 'running', pid: child.pid });
  let settled = false;
  const finalize = (patch: Partial<VideoRenderJob>) => {
    if (settled) return;
    settled = true;
    logStream.end();
    try {
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } finally {
      updateJob(projectDir, id, patch);
    }
  };
  child.on('error', (error) => {
    finalize({ status: 'failed', error: error.message });
  });
  child.on('close', (code) => {
    finalize({
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code,
      error: code === 0 ? undefined : `FFmpeg가 종료 코드 ${code}로 실패했습니다.`,
    });
  });
  return JSON.parse(readFileSync(jobPath(projectDir, id), 'utf8')) as VideoRenderJob;
}

export function getRenderJob(projectDir: string, jobId: string): VideoRenderJob & { logTail?: string } {
  const filePath = jobPath(projectDir, jobId);
  if (!existsSync(filePath)) throw new Error(`렌더 작업을 찾을 수 없습니다: ${jobId}`);
  let job = parseFile(renderJobSchema, readJson(filePath), filePath);
  const queuedStale = job.status === 'queued' && Date.now() - Date.parse(job.updatedAt) >= 60_000;
  const runningDead = job.status === 'running' &&
    Date.now() - Date.parse(job.updatedAt) >= 5_000 &&
    !processAlive(job.pid);
  if (queuedStale || runningDead) {
    job = updateJob(projectDir, jobId, {
      status: 'failed',
      error: queuedStale
        ? '렌더 작업이 시작 대기 상태에서 중단되었습니다. 다시 렌더하세요.'
        : '렌더 프로세스가 더 이상 실행 중이지 않습니다. 호스트 또는 MCP가 중단되었을 수 있습니다.',
    });
    const lockPath = `${job.outputPath}.render.lock`;
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === jobId) unlinkSync(lockPath);
    } catch {
      // A concurrent render may have already replaced or removed the stale lock.
    }
  }
  let logTail: string | undefined;
  if (job.status === 'failed' && existsSync(job.logPath)) {
    logTail = readTail(job.logPath).split(/\r?\n/).slice(-30).join('\n');
  }
  return { ...job, logTail };
}

function ffprobeFor(ffmpegPath?: string): string {
  const configured = process.env.MIMI_SEED_FFPROBE_PATH;
  if (configured) return configured;
  if (ffmpegPath && path.isAbsolute(ffmpegPath)) {
    const ext = path.extname(ffmpegPath);
    return path.join(path.dirname(ffmpegPath), `ffprobe${ext}`);
  }
  return 'ffprobe';
}

export async function validateVideo(
  filePath: string,
  ffmpegPath?: string,
): Promise<{ valid: boolean; format: unknown; streams: unknown[]; issues: string[] }> {
  if (!path.isAbsolute(filePath) || !existsSync(filePath)) {
    throw new Error('filePath는 존재하는 절대경로여야 합니다.');
  }
  const ffprobe = ffprobeFor(ffmpegPath);
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate,format_name:stream=index,codec_name,codec_type,width,height,r_frame_rate,pix_fmt',
    '-of', 'json',
    filePath,
  ], { timeout: 30_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const data = JSON.parse(stdout) as { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const issues: string[] = [];
  if (!video) issues.push('비디오 스트림이 없습니다.');
  if (video && video.codec_name !== 'h264') issues.push(`권장 코덱 H.264가 아닙니다: ${String(video.codec_name)}`);
  if (video && video.pix_fmt !== 'yuv420p') issues.push(`권장 픽셀 포맷 yuv420p가 아닙니다: ${String(video.pix_fmt)}`);
  return { valid: issues.length === 0, format: data.format ?? {}, streams, issues };
}

export const __testing = { srtTime, ffprobeFor, sanitizeSubtitleText, processAlive, acquireOutputLock, readTail };
