import { describe, it, expect } from 'vitest';
import { friendlyGoogleError, extractHttpStatus, authReauthMessage, googleErrorDetail } from '../lib/google-errors.js';
import { friendlyPlayError } from '../playstore/errors.js';

describe('extractHttpStatus', () => {
  it('reads e.code (number)', () => {
    expect(extractHttpStatus({ code: 403 })).toBe(403);
  });
  it('reads e.response.status', () => {
    expect(extractHttpStatus({ response: { status: 404 } })).toBe(404);
  });
  it('undefined when absent', () => {
    expect(extractHttpStatus(new Error('boom'))).toBeUndefined();
  });
});

describe('authReauthMessage', () => {
  it('flags invalid_grant', () => {
    expect(authReauthMessage('invalid_grant')).toContain('mimi-seed-auth');
  });
  it('null for unrelated text', () => {
    expect(authReauthMessage('some random error')).toBeNull();
  });
});

describe('googleErrorDetail', () => {
  it('extracts response.data.error.message', () => {
    const e = { response: { data: { error: { message: 'The caller does not have permission' } } } };
    expect(googleErrorDetail(e)).toContain('does not have permission');
  });
  it('extracts errors[].reason', () => {
    const e = { errors: [{ reason: 'insufficientPermissions', message: 'nope' }] };
    expect(googleErrorDetail(e)).toContain('insufficientPermissions');
  });
  it('undefined when no structured detail', () => {
    expect(googleErrorDetail(new Error('forbidden'))).toBeUndefined();
    expect(googleErrorDetail('x')).toBeUndefined();
  });
});

describe('friendlyGoogleError', () => {
  it('invalid_grant -> re-auth guidance', () => {
    const m = friendlyGoogleError(new Error('invalid_grant')).message;
    expect(m).toContain('mimi-seed-auth');
  });
  it('SERVICE_DISABLED -> activation guidance + extracts URL', () => {
    const m = friendlyGoogleError(
      new Error('Cloud Resource Manager API has not been used in project 123 before. Enable it at https://console.cloud.google.com/apis/api/x?project=123 then retry.'),
    ).message;
    expect(m).toContain('비활성화');
    expect(m).toContain('https://console.cloud.google.com/apis/api/x?project=123');
  });
  it('404 -> list_projects pointer', () => {
    expect(friendlyGoogleError({ code: 404, message: 'NOT_FOUND' }).message).toContain('firebase_list_projects');
  });
  it('billing -> billing guidance', () => {
    expect(friendlyGoogleError(new Error('BILLING_DISABLED')).message).toContain('결제');
  });
  it('preserves unknown error', () => {
    const orig = new Error('totally unrelated domain error');
    expect(friendlyGoogleError(orig)).toBe(orig);
  });
  it('ALREADY_EXISTS -> pick-another-id guidance', () => {
    const m = friendlyGoogleError(new Error('ALREADY_EXISTS: project already exists')).message;
    expect(m).toContain('전역에서 유일');
  });
  it('partialFailureNote survives a matched branch (billing)', () => {
    const e = Object.assign(new Error('BILLING_DISABLED'), {
      partialFailureNote: '⚠️ GCP 프로젝트는 이미 생성됐습니다.',
    });
    const m = friendlyGoogleError(e).message;
    expect(m).toContain('이미 생성됐습니다');
    expect(m).toContain('결제');
  });
  it('partialFailureNote survives the unrecognized-error passthrough (no longer returns the same object once a note is attached)', () => {
    const e = Object.assign(new Error('totally unrelated domain error'), {
      partialFailureNote: '⚠️ GCP 프로젝트는 이미 생성됐습니다.',
    });
    const out = friendlyGoogleError(e);
    expect(out).not.toBe(e);
    expect(out.message).toContain('이미 생성됐습니다');
    expect(out.message).toContain('totally unrelated domain error');
  });
});

describe('friendlyPlayError', () => {
  it('403 status -> Play Console permission checklist', () => {
    const m = friendlyPlayError({ code: 403, message: 'forbidden' }).message;
    expect(m).toContain('Users and permissions');
  });
  it('403 with Google detail surfaces the raw reason (not just "grant permission")', () => {
    const e = { code: 403, response: { data: { error: { message: 'Operation not allowed for this app state' } } } };
    const m = friendlyPlayError(e).message;
    expect(m).toContain('Operation not allowed for this app state');
    expect(m).toContain('Users and permissions'); // checklist still present as fallback
  });
  it('404 -> packageName hint includes the package', () => {
    const m = friendlyPlayError({ code: 404, message: 'not found' }, 'com.example.app').message;
    expect(m).toContain('com.example.app');
  });
  it('edit-session conflict -> withEdit guidance', () => {
    const m = friendlyPlayError(new Error('This Edit has been deleted')).message;
    expect(m).toContain('edit');
  });
  it('invalid_grant -> re-auth', () => {
    expect(friendlyPlayError(new Error('invalid_grant')).message).toContain('mimi-seed-auth');
  });
  it('preserves domain error', () => {
    const orig = new Error('production 트랙에 릴리스가 없어');
    expect(friendlyPlayError(orig)).toBe(orig);
  });
});
