import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const providersRoot = path.resolve(__dirname, '../../..');

const sourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.spec.')
      ? [fullPath]
      : [];
  });

const isEmptyCommentsReturn = (node: ts.Node): boolean => {
  if (!ts.isReturnStatement(node) || !node.expression || !ts.isObjectLiteralExpression(node.expression)) {
    return false;
  }
  return node.expression.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : undefined;
    return name === 'comments'
      && ts.isArrayLiteralExpression(property.initializer)
      && property.initializer.elements.length === 0;
  });
};

const hasEmptyCommentsReturn = (node: ts.Node): boolean => {
  if (isEmptyCommentsReturn(node)) return true;
  return node.getChildren().some(hasEmptyCommentsReturn);
};

describe('comment fetch failure contract', () => {
  it('never returns an authoritative empty result from a catch block', () => {
    const failures: string[] = [];
    for (const filePath of sourceFiles(providersRoot)) {
      const source = ts.createSourceFile(
        filePath,
        fs.readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isCatchClause(node) && hasEmptyCommentsReturn(node.block)) {
          failures.push(path.relative(providersRoot, filePath));
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
    expect(failures).toEqual([]);
  });
});
