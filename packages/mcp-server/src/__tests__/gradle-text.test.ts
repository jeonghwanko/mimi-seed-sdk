import { describe, expect, it } from 'vitest';
import { blankComments, closingBrace, maskStrings, removeBlocks, stripGradleComments } from '#core/checks/gradle-text.js';

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

  // Round-4 review: Groovy slashy strings and unclosed /* must not delete the rest of the file.
  it.each([
    ['slashy regex with \\/*', 'exclude ~/.*\\/*.so/\ntargetSdk 33\n'],
    ['dollar-slashy with /*', 'def x = $/ a/* /$\ntargetSdk 33\napplicationId "x.y"\n'],
    ['slashy after ( with an apostrophe', 'def r = "a".replaceAll(/\'/, "")\ntargetSdk 33\n'],
    ['slashy after a map key (exclude group: /a{/)', "exclude group: /a{/, module: 'x'\ntargetSdk 33\n"],
    ['/* with no closing */', 'def glob = 1 /* unterminated\ntargetSdk 33\n'],
    ['unterminated template "${"', 'def s = "${"\n// targetSdk 36\ntargetSdk 33\n'],
  ])('%s keeps the code after it', (_name, text) => {
    const stripped = stripGradleComments(text);

    expect(stripped).toMatch(/targetSdk 33/);
    expect(stripped).not.toContain('36');
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
  });

  it('closingBrace and removeBlocks ignore braces inside strings and comments', () => {
    const text = 'subprojects { println("}") /* } */ ext.x = 1 }\nbuildscript { ext { y = 2 } }';

    expect(removeBlocks(text, /\bsubprojects\s*\{/)).toBe('\nbuildscript { ext { y = 2 } }');
    expect(closingBrace(text, text.indexOf('{'))).toBe(text.indexOf('\n') - 1);
  });

  it('keeps line numbers: a block comment becomes the newlines it spanned', () => {
    const stripped = stripGradleComments('a\n/* one\ntwo\nthree */\nb');

    expect(stripped.split('\n')).toEqual(['a', '', '', '', 'b']);
  });
});

// Round 6: the Target API net matches tokens on masked code, at the same indexes as the original text.
describe('maskStrings / blankComments', () => {
  const text = 'println "targetSdk 33" // targetSdkVersion 30\n/* targetSdk = 29 */ targetSdk = 36';

  it('blanks string contents and comments, keeping length and line breaks', () => {
    const masked = maskStrings(text);

    expect(masked).toHaveLength(text.length);
    expect(masked.split('\n')).toHaveLength(2);
    expect(masked.match(/targetSdk/g)).toHaveLength(1);
    expect(masked.indexOf('targetSdk = 36')).toBe(text.lastIndexOf('targetSdk = 36'));
    expect(masked).toContain('println "            "');
  });

  it('blankComments keeps strings', () => {
    const blanked = blankComments(text);

    expect(blanked).toHaveLength(text.length);
    expect(blanked).toContain('"targetSdk 33"');
    expect(blanked).not.toContain('targetSdkVersion 30');
    expect(blanked).not.toContain('= 29');
  });
});
