import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * specs/07-TASKS.md T22, THE TEST THAT MATTERS #1: "a test that walks every
 * route handler's response shape and fails if any key matches
 * /token|secret|_enc$/i."
 *
 * This is a STATIC analysis, not an execution harness: it asks the
 * TypeScript compiler what TYPE every `NextResponse.json(...)` /
 * `Response.json(...)` call's argument has, in every app/api/** /route.ts
 * file, and walks that type's properties recursively. That's deliberately
 * stronger than invoking each handler with mocked dependencies and
 * inspecting one runtime response: a handler has multiple return paths
 * (success, several error branches), and exercising all of them with
 * correct mocks per route would either miss branches or require duplicating
 * every route test file's mock setup here. The type checker already knows
 * the shape of every literal object and every named response type (like
 * `RunListItem`, `PreviewResult`, `CurrentPortal`) that could flow into
 * NextResponse.json, in every branch, without running any of them.
 */

const ROOT = join(__dirname, '..', '..');
const FORBIDDEN_KEY_PATTERN = /token|secret|_enc$/i;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  path: string;
}

function loadProgram(routeFiles: string[]): { program: ts.Program; checker: ts.TypeChecker } {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

  const program = ts.createProgram(routeFiles, parsed.options);
  return { program, checker: program.getTypeChecker() };
}

/** Promise<T> -> T. NextResponse.json's argument is occasionally the direct result of an awaited call, but can appear un-awaited in a returned expression too - handled either way since callers always pass the argument expression's own type. */
function unwrapPromise(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  const symbol = type.getSymbol();
  if (symbol?.getName() === 'Promise') {
    const [inner] = checker.getTypeArguments(type as ts.TypeReference);
    if (inner) return unwrapPromise(checker, inner);
  }
  return type;
}

const MAX_DEPTH = 12;

function walkType(
  checker: ts.TypeChecker,
  type: ts.Type,
  keyPath: string,
  depth: number,
  visitedTypeIds: Set<number>,
  violations: Violation[],
  file: string,
): void {
  if (depth > MAX_DEPTH) return;

  type = unwrapPromise(checker, type);

  if (type.isUnion()) {
    for (const member of type.types) walkType(checker, member, keyPath, depth, visitedTypeIds, violations, file);
    return;
  }

  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (element) walkType(checker, element, `${keyPath}[]`, depth + 1, visitedTypeIds, violations, file);
    return;
  }

  // Cycle guard: a type visited once on THIS path is not re-walked. Using
  // the internal numeric type id (present on every ts.Type at runtime,
  // even though not part of the public .d.ts surface) is the standard way
  // to dedupe types structurally rather than by reference.
  const typeId = (type as unknown as { id?: number }).id;
  if (typeId !== undefined) {
    if (visitedTypeIds.has(typeId)) return;
    visitedTypeIds.add(typeId);
  }

  for (const prop of type.getProperties()) {
    const name = prop.getName();
    if (FORBIDDEN_KEY_PATTERN.test(name)) {
      violations.push({ file, path: `${keyPath}.${name}` });
      continue; // the value itself is not walked - the key alone is already the violation
    }

    let propType: ts.Type;
    try {
      propType = checker.getTypeOfSymbol(prop);
    } catch {
      continue; // an unresolvable symbol (rare, e.g. some generic edge cases) - nothing to walk
    }

    const typeText = checker.typeToString(propType);
    if (typeText === 'Date' || typeText.includes('=>')) continue; // not object shapes worth descending into

    walkType(checker, propType, `${keyPath}.${name}`, depth + 1, new Set(visitedTypeIds), violations, file);
  }
}

function findResponseJsonViolations(): Violation[] {
  const routeFiles = findRouteFiles(join(ROOT, 'app', 'api'));
  if (routeFiles.length === 0) throw new Error('No app/api/**/route.ts files found - the walker found nothing to check');

  const { program, checker } = loadProgram(routeFiles);
  const violations: Violation[] = [];

  for (const routeFile of routeFiles) {
    const sourceFile = program.getSourceFile(routeFile);
    if (!sourceFile) throw new Error(`TypeScript could not load ${routeFile}`);

    const relPath = relative(ROOT, routeFile);

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'json' &&
          ts.isIdentifier(callee.expression) &&
          (callee.expression.text === 'NextResponse' || callee.expression.text === 'Response')
        ) {
          const [arg] = node.arguments;
          if (arg) {
            const argType = checker.getTypeAtLocation(arg);
            walkType(checker, argType, relPath, 0, new Set(), violations, relPath);
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return violations;
}

describe('every app/api route handler response shape - no key matches /token|secret|_enc$/i', () => {
  it('finds route files to check (a sanity guard against the walker silently checking nothing)', () => {
    const routeFiles = findRouteFiles(join(ROOT, 'app', 'api'));
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  it('has no NextResponse.json/Response.json call anywhere whose argument type carries a token/secret/_enc key', () => {
    const violations = findResponseJsonViolations();

    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}: ${v.path}`).join('\n');
      throw new Error(`Found response shapes with a forbidden key:\n${report}`);
    }

    expect(violations).toEqual([]);
  });

  it('the detector actually works: a deliberately-injected forbidden key IS caught (a positive control)', () => {
    // Proves the walker isn't vacuously passing because it fails to find
    // anything - run it against a throwaway fixture file containing a known
    // violation and confirm it's reported.
    const fixtureDir = join(ROOT, 'tests', 'security', '__fixtures__', 'leaky-route');
    const fixtureFile = join(fixtureDir, 'route.ts');

    const { program, checker } = loadProgram([fixtureFile]);
    const sourceFile = program.getSourceFile(fixtureFile);
    expect(sourceFile).toBeDefined();

    const violations: Violation[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'json' &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'NextResponse'
        ) {
          const [arg] = node.arguments;
          if (arg) {
            const argType = checker.getTypeAtLocation(arg);
            walkType(checker, argType, 'fixture', 0, new Set(), violations, 'fixture');
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile!);

    expect(violations.some((v) => v.path.includes('refreshToken'))).toBe(true);
  });
});
