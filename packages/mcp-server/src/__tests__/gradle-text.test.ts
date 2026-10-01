import { describe, expect, it } from 'vitest';
import { stripGradleComments } from '#core/checks/gradle-text.js';

// Round-3 review: the regex stripper treated `/*` inside glob strings as a comment and ate real code up to the next
// `*/` (Signal-Android lost its targetSdk line, Lawnchair its applicationId).
describe('stripGradleComments (string-aware)', () => {
  it('keeps code after a glob string that contains /*', () => {
    const text = [
      "packagingOptions { pickFirst '**/*.so' }",
      'defaultConfig { applicationId "com.example.app"; targetSdkVersion 34 }',
      '/* release signing is configured on CI */',
    ].join('\n');

    const stripped = stripGradleComments(text);

    expect(stripped).toContain("pickFirst '**/*.so'");
    expect(stripped).toContain('targetSdkVersion 34');
    expect(stripped).not.toContain('release signing');
  });

  it('Signal-style: a glob, real code, then a /** doc */ block', () => {
    const text = [
      'packaging { resources { excludes += setOf("**/*.dylib", "META-INF/*") } }',
      'android {',
      '  defaultConfig { targetSdk = 35 }',
      '}',
      '/** Returns the version code. */',
      'fun versionCode() = 1',
    ].join('\n');

    const stripped = stripGradleComments(text);

    expect(stripped).toContain('targetSdk = 35');
    expect(stripped).toContain('fun versionCode() = 1');
    expect(stripped).not.toContain('Returns the version code');
  });

  it('treats // inside a string (a URL) as text but removes a trailing comment', () => {
    const stripped = stripGradleComments('maven { url "https://example.com/maven" } // company mirror\nval x = 1');

    expect(stripped).toContain('url "https://example.com/maven"');
    expect(stripped).not.toContain('company mirror');
    expect(stripped).toContain('val x = 1');
  });

  it('handles escapes, triple quotes, and ${…} templates with nested strings', () => {
    const text = [
      'val a = "quote \\" then /* not a comment"',
      'val b = """multi',
      '  line /* still text */ "inner" """',
      'val c = "${project.findProperty("glob") ?: "lib/*/x.so"} done"',
      "val d = '''groovy /* text */'''",
      'targetSdk = 34 // trailing',
    ].join('\n');

    const stripped = stripGradleComments(text);

    expect(stripped).toContain('"quote \\" then /* not a comment"');
    expect(stripped).toContain('line /* still text */ "inner" """');
    expect(stripped).toContain('"${project.findProperty("glob") ?: "lib/*/x.so"} done"');
    expect(stripped).toContain("'''groovy /* text */'''");
    expect(stripped).toContain('targetSdk = 34');
    expect(stripped).not.toContain('trailing');
  });

  it('keeps line numbers: a block comment becomes the newlines it spanned', () => {
    const stripped = stripGradleComments('a\n/* one\ntwo\nthree */\nb');

    expect(stripped.split('\n')).toEqual(['a', '', '', '', 'b']);
  });
});
