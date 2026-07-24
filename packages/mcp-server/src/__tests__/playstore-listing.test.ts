import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const api = vi.hoisted(() => ({
  insert: vi.fn(),
  commit: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    androidpublisher: () => ({
      edits: {
        insert: api.insert,
        commit: api.commit,
        delete: api.delete,
        listings: {
          patch: api.patch,
          update: api.update,
        },
      },
    }),
  },
}));

import { updateListing } from '../playstore/tools.js';

const auth = {} as OAuth2Client;

beforeEach(() => {
  vi.clearAllMocks();
  api.insert.mockResolvedValue({ data: { id: 'edit-1' } });
  api.commit.mockResolvedValue({ data: {} });
});

describe('updateListing', () => {
  it('기존 언어는 PATCH로 일부 필드만 수정한다', async () => {
    api.patch.mockResolvedValue({ data: { title: 'Updated' } });

    await updateListing(auth, 'com.example.app', 'en-US', { title: 'Updated' });

    expect(api.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'com.example.app',
        language: 'en-US',
        requestBody: { title: 'Updated' },
      }),
    );
    expect(api.update).not.toHaveBeenCalled();
    expect(api.commit).toHaveBeenCalledOnce();
  });

  it('새 언어의 PATCH 404는 완전한 PUT으로 생성한다', async () => {
    api.patch.mockRejectedValue({ code: 404, message: 'Listing not found' });
    api.update.mockResolvedValue({ data: { language: 'en-US' } });
    const listing = {
      title: 'Example',
      shortDescription: 'A short description',
      fullDescription: 'A complete store description.',
    };

    await updateListing(auth, 'com.example.app', 'en-US', listing);

    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'com.example.app',
        language: 'en-US',
        requestBody: listing,
      }),
    );
    expect(api.commit).toHaveBeenCalledOnce();
  });

  it('새 언어를 일부 필드만으로 만들지 않는다', async () => {
    api.patch.mockRejectedValue({ response: { status: 404 }, message: 'Listing not found' });

    await expect(
      updateListing(auth, 'com.example.app', 'en-US', { title: 'Example' }),
    ).rejects.toThrow('title, shortDescription, fullDescription');

    expect(api.update).not.toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();
  });

  it('404가 아닌 오류는 PUT으로 우회하지 않는다', async () => {
    const denied = { code: 403, message: 'Forbidden' };
    api.patch.mockRejectedValue(denied);

    await expect(
      updateListing(auth, 'com.example.app', 'en-US', {
        title: 'Example',
        shortDescription: 'A short description',
        fullDescription: 'A complete store description.',
      }),
    ).rejects.toBe(denied);

    expect(api.update).not.toHaveBeenCalled();
  });
});

