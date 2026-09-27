import { describe, expect, it } from 'vitest';
import { jenkinsUrlWarning } from '../jenkins/config.js';

/**
 * Jenkins URL 의 http 경고 (2026-09 보안 점검).
 *
 * 사내 LAN·Tailscale 의 Jenkins 컨트롤러는 http 로 도는 게 흔하고 정당하다 — https 를
 * 강제하면 정상 설정이 막힌다. 대신 **공인 호스트에 평문 http** 인 경우에만 토큰이
 * 암호화 없이 나간다고 경고한다. 저장은 막지 않는다.
 */
describe('jenkinsUrlWarning', () => {
  it.each([
    'https://jenkins.example.com',
    'http://192.168.0.10:8080',
    'http://10.0.0.5',
    'http://172.20.1.1:8080',
    'http://100.100.1.2:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
    'http://[::1]:8080',
    'http://[fd12:3456::1]:8080',
    'http://jenkins:8080',
    'http://ci.office.lan',
    'http://jenkins.corp.internal',
    'http://build-box.tailnet-example.ts.net',
  ])('%s 는 경고하지 않는다', (url) => {
    expect(jenkinsUrlWarning(url)).toBeNull();
  });

  it.each([
    'http://jenkins.example.com',
    'http://203.0.113.10:8080',
    'http://172.32.0.1',
    'http://100.128.0.1',
  ])('%s 는 평문 공인 호스트로 경고한다', (url) => {
    expect(jenkinsUrlWarning(url)).toMatch(/http/);
  });
});
