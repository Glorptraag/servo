// Collects the strings that app and parent show to a child or an adult (R-6.4 TLS-3), for ui-copy.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** One string as written in source: where it is, and its text. */
export interface UiString {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * JSX attributes whose value is never shown: ids, classes, roles, types, links and test hooks. Every other
 * attribute is read, so aria-label, title, alt, placeholder and the aria-* descriptions are checked.
 */
const HIDDEN_ATTRIBUTES = new Set([
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-haspopup',
  'aria-labelledby',
  'aria-live',
  'aria-orientation',
  'aria-owns',
  'aria-relevant',
  'autoCapitalize',
  'autoComplete',
  'autoCorrect',
  'className',
  'dir',
  'download',
  'form',
  'href',
  'htmlFor',
  'id',
  'inputMode',
  'key',
  'lang',
  'method',
  'name',
  'rel',
  'role',
  'spellCheck',
  'src',
  'target',
  'type',
  'viewBox',
]);

const hiddenAttribute = (name: string): boolean =>
  HIDDEN_ATTRIBUTES.has(name) || name.startsWith('data-') || /^(?:d|fill|stroke|transform|points|xmlns)$/.test(name) || /^stroke[A-Z]|^fill[A-Z]/.test(name);

/** A string in a place that is code, not copy: a module path, a type, a property key or a JSX attribute that is not shown. */
const isCode = (node: ts.Node): boolean => {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true;
  if (ts.isJsxAttribute(parent) && hiddenAttribute(parent.name.getText())) return true;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && hiddenAttribute(parent.parent.name.getText())) return true;
  // A value compared with or switched on, such as a key name in `event.key === 'Escape'`, is never shown.
  if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent) && parent.expression === node) return true;
  if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'RegExp') return true;
  return false;
};

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', apos: "'", excl: '!', gt: '>', lt: '<', nbsp: ' ', quot: '"' };

/** JSX text and JSX attribute strings as React shows them, with `&#33;`, `&#x21;` and `&excl;` decoded. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (whole, decimal?: string, hex?: string, name?: string) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    return NAMED_ENTITIES[name?.toLowerCase() ?? ''] ?? whole;
  });

/** The shown strings of one source text: string literals, template text and JSX text, outside the places isCode names. */
export const uiStringsOf = (file: string, source: string): UiString[] => {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out: UiString[] = [];
  const take = (node: ts.Node, text: string): void => {
    const first = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    // JSX text wraps for layout, so its lines are one; a string's own line breaks end its lines, as in a Markdown note.
    const lines = ts.isJsxText(node) ? [text] : text.split('\n');
    lines.forEach((line, offset) => {
      const trimmed = line.replace(/\s+/g, ' ').trim();
      if (trimmed !== '') out.push({ file, line: first + offset, text: trimmed });
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) take(node, decodeEntities(node.text));
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isCode(node)) {
      take(node, ts.isJsxAttribute(node.parent) ? decodeEntities(node.text) : node.text);
    } else if (ts.isTemplateExpression(node) && !isCode(node)) {
      take(node.head, node.head.text);
      for (const span of node.templateSpans) take(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return out;
};

/** Every `.ts` and `.tsx` file under a folder, in sorted order. */
export const sourceFiles = (folder: string): string[] =>
  fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted();

export const uiStringsIn = (folder: string): UiString[] => sourceFiles(folder).flatMap((file) => uiStringsOf(file, fs.readFileSync(file, 'utf8')));
