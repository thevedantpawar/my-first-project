import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'data', '.vite', 'coverage']);
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html', '.example']);

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const extension = dot === -1 ? '' : entry.slice(dot);
    if (TEXT_EXTENSIONS.has(extension) || entry === '.env.example') files.push(path);
  }
  return files;
}

/** This test file names the forbidden terms, so it must exclude itself. */
const FILES = walk(ROOT).filter((path) => !path.endsWith('no-twitter.test.ts'));

describe('LinkedIn-only guarantee', () => {
  it('finds source files to scan', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('contains no Twitter/X credentials, endpoints or dependencies', () => {
    // The words "Twitter/X" appear on purpose in the docs and in the dashboard's
    // "deliberately unsupported" list. What must not exist is anything that
    // could actually talk to it.
    const forbidden = [
      /TWITTER_[A-Z_]+/,
      /\bX_API_[A-Z_]+/,
      /api\.twitter\.com/i,
      /api\.x\.com/i,
      /upload\.twitter\.com/i,
      /['"`]twitter-api[^'"`]*['"`]/i,
      /from ['"`][^'"`]*twitter[^'"`]*['"`]/i,
      /require\(['"`][^'"`]*twitter[^'"`]*['"`]\)/i,
    ];
    const offenders: string[] = [];
    for (const file of FILES) {
      const contents = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(contents)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no Twitter/X dependency in any package.json', () => {
    const manifests = FILES.filter((file) => file.endsWith('package.json'));
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const names = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ];
      expect(names.filter((name) => /twitter|(^|\W)x-api/i.test(name))).toEqual([]);
    }
  });

  it('never implements comment replies, commenter mentions or DMs', () => {
    // Only the LinkedIn provider may talk to LinkedIn, and only via /rest/posts
    // and /rest/images. Any messaging or comment endpoint would show up here.
    const forbiddenEndpoints = [
      /rest\/(?:socialActions|messages|conversations|invitations)/,
      /messaging\/conversations/,
      /ugcPosts\/[^/]+\/comments/,
    ];
    const offenders: string[] = [];
    for (const file of FILES) {
      const contents = readFileSync(file, 'utf8');
      for (const pattern of forbiddenEndpoints) {
        if (pattern.test(contents)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps .env out of version control', () => {
    const gitignore = readFileSync(resolve(ROOT, '..', '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
  });

  it('ships an .env.example with no filled-in secrets', () => {
    const example = readFileSync(resolve(ROOT, '.env.example'), 'utf8');
    for (const key of [
      'GEMINI_API_KEY',
      'TAVILY_API_KEY',
      'LINKEDIN_ACCESS_TOKEN',
      'LINKEDIN_PERSON_URN',
      'GOOGLE_SHEETS_ID',
      'GOOGLE_SHEETS_ACCESS_TOKEN',
    ]) {
      expect(example).toMatch(new RegExp(`^${key}=\\s*$`, 'm'));
    }
  });
});
