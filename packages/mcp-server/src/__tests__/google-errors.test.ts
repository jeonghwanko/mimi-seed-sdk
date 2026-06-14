import { describe, it, expect } from 'vitest';
import { friendlyGoogleError, extractHttpStatus, authReauthMessage } from '../lib/google-errors.js';
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
});

describe('friendlyPlayError', () => {
  it('403 status -> Play Console permission checklist', () => {
    const m = friendlyPlayError({ code: 403, message: 'forbidden' }).message;
    expect(m).toContain('Users and permissions');
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
