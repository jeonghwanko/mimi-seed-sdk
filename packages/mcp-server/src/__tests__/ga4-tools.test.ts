import { describe, it, expect } from 'vitest';
import {
  normalizeAccountName,
  normalizePropertyName,
  normalizeCloudProjectName,
  buildDataStreamBody,
  flattenDataStream,
  buildBigQueryLinkBody,
  flattenBigQueryLink,
} from '../ga4/tools.js';

describe('GA4 path normalization', () => {
  it('bare ID 에 리소스 접두어를 붙인다', () => {
    expect(normalizeAccountName('123')).toBe('accounts/123');
    expect(normalizePropertyName('456')).toBe('properties/456');
  });

  it('이미 접두어가 있으면 그대로 둔다', () => {
    expect(normalizeAccountName('accounts/123')).toBe('accounts/123');
    expect(normalizePropertyName('properties/456')).toBe('properties/456');
  });

  it('공백을 trim 한다', () => {
    expect(normalizeAccountName('  789 ')).toBe('accounts/789');
    expect(normalizePropertyName(' 1011 ')).toBe('properties/1011');
  });
});

describe('GA4 BigQuery link helpers', () => {
  it('Cloud project 경로를 정규화한다', () => {
    expect(normalizeCloudProjectName('sample-project')).toBe('projects/sample-project');
    expect(normalizeCloudProjectName(' projects/12345 ')).toBe('projects/12345');
  });

  it('보수적인 기본값으로 생성 본문을 만든다', () => {
    expect(
      buildBigQueryLinkBody({ projectId: 'sample-project', datasetLocation: ' asia-northeast3 ' }),
    ).toEqual({
      project: 'projects/sample-project',
      datasetLocation: 'asia-northeast3',
      dailyExportEnabled: true,
      streamingExportEnabled: false,
      freshDailyExportEnabled: false,
      includeAdvertisingId: false,
    });
  });

  it('명시한 export 옵션을 유지한다', () => {
    const body = buildBigQueryLinkBody({
      projectId: '12345',
      datasetLocation: 'US',
      dailyExportEnabled: false,
      streamingExportEnabled: true,
      freshDailyExportEnabled: true,
      includeAdvertisingId: true,
    });
    expect(body).toMatchObject({
      project: 'projects/12345',
      dailyExportEnabled: false,
      streamingExportEnabled: true,
      freshDailyExportEnabled: true,
      includeAdvertisingId: true,
    });
  });

  it('BigQuery link 응답의 누락 필드를 안전한 기본값으로 평탄화한다', () => {
    expect(flattenBigQueryLink({ project: 'projects/12345' })).toEqual({
      name: null,
      project: 'projects/12345',
      datasetLocation: null,
      createTime: null,
      dailyExportEnabled: false,
      streamingExportEnabled: false,
      freshDailyExportEnabled: false,
      includeAdvertisingId: false,
    });
  });
});

describe('buildDataStreamBody', () => {
  it('web → WEB_DATA_STREAM + webStreamData.defaultUri', () => {
    expect(
      buildDataStreamBody({ platform: 'web', displayName: 'Web', defaultUri: 'https://x.com' }),
    ).toEqual({
      type: 'WEB_DATA_STREAM',
      displayName: 'Web',
      webStreamData: { defaultUri: 'https://x.com' },
    });
  });

  it('android → ANDROID_APP_DATA_STREAM + packageName', () => {
    expect(
      buildDataStreamBody({ platform: 'android', displayName: 'A', packageName: 'com.x.y' }),
    ).toEqual({
      type: 'ANDROID_APP_DATA_STREAM',
      displayName: 'A',
      androidAppStreamData: { packageName: 'com.x.y' },
    });
  });

  it('ios → IOS_APP_DATA_STREAM + bundleId', () => {
    expect(
      buildDataStreamBody({ platform: 'ios', displayName: 'I', bundleId: 'com.x.y' }),
    ).toEqual({
      type: 'IOS_APP_DATA_STREAM',
      displayName: 'I',
      iosAppStreamData: { bundleId: 'com.x.y' },
    });
  });
});

describe('flattenDataStream', () => {
  it('web stream 은 measurementId 를 끌어낸다', () => {
    const f = flattenDataStream({
      name: 'properties/1/dataStreams/2',
      type: 'WEB_DATA_STREAM',
      displayName: 'Web',
      webStreamData: { measurementId: 'G-ABC123', defaultUri: 'https://x.com' },
    });
    expect(f.measurementId).toBe('G-ABC123');
    expect(f.firebaseAppId).toBeNull();
  });

  it('app stream 은 firebaseAppId 를 끌어낸다 (android/ios 공통)', () => {
    expect(
      flattenDataStream({ type: 'ANDROID_APP_DATA_STREAM', androidAppStreamData: { firebaseAppId: '1:a:android:b' } })
        .firebaseAppId,
    ).toBe('1:a:android:b');
    expect(
      flattenDataStream({ type: 'IOS_APP_DATA_STREAM', iosAppStreamData: { firebaseAppId: '1:a:ios:b' } })
        .firebaseAppId,
    ).toBe('1:a:ios:b');
  });

  it('누락 필드는 null 로 안전 처리', () => {
    expect(flattenDataStream({})).toEqual({
      name: null,
      type: null,
      displayName: null,
      measurementId: null,
      firebaseAppId: null,
    });
  });
});
