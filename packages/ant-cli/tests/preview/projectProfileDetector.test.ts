/**
 * Locks manifest-based project profile detection — the fix for the Preview
 * Config "프로젝트 프로파일" card showing 감지되지 않음 for language/framework.
 *
 * Before this, the ONLY writer of `projectProfile` was a code job's decompose
 * node broadcasting the LLM's `<techTier>` guess; nothing on the preview path
 * ever derived a framework from the codebase. `quickDetect` returned language
 * only, and additionally mislabelled every non-workspace Node project as
 * `frontend-only` (so a NestJS repo read `frontend-only` idle, `backend-only`
 * running).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  frameworkFromManifests,
  languageFromManifests,
  readManifests,
  staticDocRoot,
  staticEntryFile,
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/manifest';
import { ProjectProfileDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';

let root: string;

/** Write a fixture tree: `{ 'package.json': {...}, 'src/main.go': 'text' }`. */
function fixture(name: string, files: Record<string, unknown>): string {
  const dir = path.join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const pkg = (extra: Record<string, unknown>) => ({ name: 'fx', ...extra });

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-profile-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('manifest → language / framework', () => {
  it('vite + react → typescript / react', () => {
    const dir = fixture('vite-react', {
      'package.json': pkg({
        scripts: { dev: 'vite' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^7.0.0', typescript: '^5.9.0' },
      }),
      'tsconfig.json': '{}',
    });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('typescript');
    expect(frameworkFromManifests(m, 'frontend')).toBe('react');
  });

  it('next → nextjs (meta-framework wins over the react it depends on)', () => {
    const dir = fixture('next-app', {
      'package.json': pkg({
        scripts: { dev: 'next dev' },
        dependencies: { next: '^15.0.0', react: '^19.0.0' },
      }),
      'tsconfig.json': '{}',
    });
    const m = readManifests(dir)!;
    expect(frameworkFromManifests(m, 'frontend')).toBe('nextjs');
  });

  it('nestjs backend → nestjs', () => {
    const dir = fixture('nest-api', {
      'package.json': pkg({
        scripts: { 'start:dev': 'nest start --watch' },
        dependencies: { '@nestjs/core': '^11.0.0' },
      }),
      'tsconfig.json': '{}',
    });
    const m = readManifests(dir)!;
    expect(frameworkFromManifests(m, 'backend')).toBe('nestjs');
  });

  it('type-directed order: a backend that also ships react still reports nestjs', () => {
    const dir = fixture('nest-with-react', {
      'package.json': pkg({
        scripts: { 'start:dev': 'nest start --watch' },
        dependencies: { '@nestjs/core': '^11.0.0', react: '^19.0.0' },
      }),
      'tsconfig.json': '{}',
    });
    const m = readManifests(dir)!;
    expect(frameworkFromManifests(m, 'backend')).toBe('nestjs');
    // Without the type bias the UI-library table would answer first.
    expect(frameworkFromManifests(m, 'frontend')).toBe('react');
  });

  it('no tsconfig and no typescript dep → javascript', () => {
    const dir = fixture('plain-js', {
      'package.json': pkg({ scripts: { start: 'node index.js' }, dependencies: { express: '^5.0.0' } }),
    });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('javascript');
    expect(frameworkFromManifests(m, 'backend')).toBe('express');
  });

  it('go.mod + gin → go / gin', () => {
    const dir = fixture('go-gin', {
      'go.mod': 'module example.com/api\n\ngo 1.23\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
      'main.go': 'package main',
    });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('go');
    expect(frameworkFromManifests(m)).toBe('gin');
  });

  it('requirements.txt + fastapi → python / fastapi', () => {
    const dir = fixture('py-fastapi', { 'requirements.txt': 'fastapi==0.115.0\nuvicorn\n' });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('python');
    expect(frameworkFromManifests(m)).toBe('fastapi');
  });

  it('manage.py wins over a pinned dep name → django', () => {
    const dir = fixture('py-django', {
      'pyproject.toml': '[project]\nname = "site"\ndependencies = ["fastapi"]\n',
      'manage.py': '#!/usr/bin/env python',
    });
    const m = readManifests(dir)!;
    expect(frameworkFromManifests(m)).toBe('django');
  });

  it('Cargo.toml + axum → rust / axum', () => {
    const dir = fixture('rs-axum', {
      'Cargo.toml': '[package]\nname = "api"\n\n[dependencies]\naxum = "0.8"\n',
    });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('rust');
    expect(frameworkFromManifests(m)).toBe('axum');
  });

  it('pom.xml + spring-boot → java / spring-boot', () => {
    const dir = fixture('jvm-spring', {
      'pom.xml': '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
    });
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('java');
    expect(frameworkFromManifests(m)).toBe('spring-boot');
  });

  it("Makefile-only → language undefined, never the literal 'unknown'", () => {
    const dir = fixture('make-only', { Makefile: 'dev:\n\t./run.sh\n' });
    const m = readManifests(dir)!;
    const language = languageFromManifests(m);
    expect(language).toBeUndefined();
    expect(language).not.toBe('unknown');
  });

  it('empty dir → null (not a project)', () => {
    const dir = fixture('empty', {});
    expect(readManifests(dir)).toBeNull();
  });

  it.each([
    ['index.html at the root', 'static-root', { 'index.html': '<h1>hi</h1>' }, '.', 'index.html'],
    ['public/index.html', 'static-public', { 'public/index.html': '<h1>hi</h1>' }, 'public', 'index.html'],
    ['a single non-index html at the root', 'static-named', { 'ax-tf-weekly-report.html': '<h1>hi</h1>' }, '.', 'ax-tf-weekly-report.html'],
    ['an index.html in a LATER doc root beats a non-index html in an earlier one', 'static-cross-root', { 'report.html': '<h1/>', 'public/index.html': '<h1/>' }, 'public', 'index.html'],
    ['index.html beats a sibling non-index html', 'static-index-pref', { 'index.html': '<h1/>', 'report.html': '<h1/>' }, '.', 'index.html'],
    ['multiple non-index html → lexicographically first', 'static-multi', { 'zeta.html': '<h1/>', 'alpha.html': '<h1/>' }, '.', 'alpha.html'],
    ['dot-named html is skipped, sibling wins', 'static-dot-sibling', { '.secret.html': '<h1/>', 'report.html': '<h1/>' }, '.', 'report.html'],
  ])('%s → html, docRoot + entry', (_label, name, files, docRoot, entry) => {
    const dir = fixture(name, files as Record<string, unknown>);
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe('html');
    expect(frameworkFromManifests(m)).toBeUndefined();
    expect(staticDocRoot(dir)).toBe(path.join(dir, docRoot === '.' ? '' : docRoot));
    expect(staticEntryFile(dir)).toBe(entry);
  });

  it.each([
    ['only a dot-named html', 'static-dot-only', { '.secret.html': '<h1/>' }],
    ['a directory named foo.html', 'static-dir-html', { 'foo.html/readme.txt': 'not html' }],
  ])('%s is NOT a static project', (_label, name, files) => {
    const dir = fixture(name, files as Record<string, unknown>);
    expect(readManifests(dir)).toBeNull();
    expect(staticEntryFile(dir)).toBeUndefined();
  });

  it.each([
    ['package.json without a dev script', { 'package.json': { name: 'x', scripts: { build: 'tsc' } }, 'index.html': '<h1/>' }, 'javascript'],
    ['a Makefile with only build:', { Makefile: 'build:\n\ttrue\n', 'index.html': '<h1/>' }, undefined],
  ])('index.html alongside %s does NOT become a static project', (_label, files, expected) => {
    const dir = fixture(`static-guard-${_label.replace(/\W/g, '')}`, files as Record<string, unknown>);
    const m = readManifests(dir)!;
    expect(languageFromManifests(m)).toBe(expected);
    expect(staticDocRoot(dir)).toBeUndefined();
  });
});

describe('ProjectProfileDetector.detectFacts', () => {
  const detect = (dir: string) => new ProjectProfileDetector().detectFacts(dir);

  it('vite + react → frontend-only, react, source manifest', async () => {
    const facts = await detect(path.join(root, 'vite-react'));
    expect(facts).not.toBeNull();
    expect(facts!.structureType).toBe('frontend-only');
    expect(facts!.profile).toMatchObject({ language: 'typescript', framework: 'react', source: 'manifest' });
    expect(facts!.canStart).toBe(true);
  });

  it('static site → frontend-only / html, startable, root entry', async () => {
    const facts = await detect(path.join(root, 'static-root'));
    expect(facts).not.toBeNull();
    expect(facts!.structureType).toBe('frontend-only');
    expect(facts!.profile).toMatchObject({ language: 'html', source: 'manifest' });
    expect(facts!.profile.framework).toBeUndefined();
    expect(facts!.canStart).toBe(true);
    expect(facts!.structure!.entry?.type).toBe('frontend');
  });

  it('nestjs-only → backend-only (was frontend-only under quickDetect)', async () => {
    const facts = await detect(path.join(root, 'nest-api'));
    expect(facts!.structureType).toBe('backend-only');
    expect(facts!.profile.framework).toBe('nestjs');
  });

  it('go module → backend-only / go / gin', async () => {
    const facts = await detect(path.join(root, 'go-gin'));
    expect(facts!.structureType).toBe('backend-only');
    expect(facts!.profile).toMatchObject({ language: 'go', framework: 'gin' });
  });

  it('pnpm workspace with a next app and a nest api → monorepo, frontend entry represents', async () => {
    const dir = fixture('mono', {
      'package.json': pkg({ private: true }),
      'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n',
      'apps/web/package.json': {
        name: 'web',
        scripts: { dev: 'next dev' },
        dependencies: { next: '^15.0.0', react: '^19.0.0' },
      },
      'apps/api/package.json': {
        name: 'api',
        scripts: { 'start:dev': 'nest start --watch' },
        dependencies: { '@nestjs/core': '^11.0.0' },
      },
    });
    const facts = await detect(dir);
    expect(facts!.structureType).toBe('monorepo');
    expect(facts!.profile.framework).toBe('nextjs');
    // Per-directory profiles, not the root's stamped onto everything.
    const byName = Object.fromEntries(
      facts!.structure!.packages.map(p => [p.name, p.projectProfile?.framework]),
    );
    expect(byName['apps/web']).toBe('nextjs');
    expect(byName['apps/api']).toBe('nestjs');
  });

  it('frontend/ + backend/ subdirs → fullstack', async () => {
    const dir = fixture('fullstack', {
      'package.json': pkg({ private: true }),
      'frontend/package.json': {
        name: 'fe',
        scripts: { dev: 'vite' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^7.0.0' },
      },
      'backend/package.json': {
        name: 'be',
        scripts: { dev: 'tsx watch src/main.ts' },
        dependencies: { express: '^5.0.0' },
      },
    });
    const facts = await detect(dir);
    expect(facts!.structureType).toBe('fullstack');
  });

  it('empty dir with no hint → null', async () => {
    expect(await detect(path.join(root, 'empty'))).toBeNull();
  });

  it('Makefile-only → recognized, language absent (feeds the generic spawn branch)', async () => {
    const facts = await detect(path.join(root, 'make-only'));
    expect(facts).not.toBeNull();
    expect(facts!.profile.language).toBeUndefined();
    expect(facts!.profile.source).toBe('manifest');
    expect(facts!.canStart).toBe(true);
    // Every package carries the same language-less profile, so
    // `resolveSpawnLanguage` yields 'unknown' rather than the Node branch.
    expect(facts!.structure!.packages.every(p => p.projectProfile?.language === undefined)).toBe(true);
  });

  it('greenfield falls back to the hint, omits structure, and cannot start', async () => {
    const facts = await new ProjectProfileDetector().detectFacts(path.join(root, 'empty'), {
      language: 'typescript',
      framework: 'nextjs',
      structureType: 'fullstack',
      source: 'techtier-hint',
    });
    expect(facts!.profile).toMatchObject({ framework: 'nextjs', source: 'techtier-hint' });
    expect(facts!.canStart).toBe(false);
    // Absent on purpose: an empty structure would wipe the cached connections.
    expect(facts!.structure).toBeUndefined();
  });

  it('filesystem beats the hint (a typescript hint on a go repo)', async () => {
    const facts = await new ProjectProfileDetector().detectFacts(path.join(root, 'go-gin'), {
      language: 'typescript',
      framework: 'nextjs',
      source: 'techtier-hint',
    });
    expect(facts!.profile).toMatchObject({ language: 'go', framework: 'gin', source: 'manifest' });
  });
});
