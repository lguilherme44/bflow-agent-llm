import { Lang, parse, SgNode } from '@ast-grep/napi';
import { CodeLanguage, TextPatch } from '../types/index.js';
import { detectLanguage, rangeFromOffsets } from './source.js';

export interface StructuralSearchMatch {
  filepath: string;
  kind: string;
  text: string;
  range: TextPatch['range'];
}

export interface StructuralReplacementPlan {
  matches: StructuralSearchMatch[];
  patches: TextPatch[];
  fallbackReason?: string;
}

export class AstGrepService {
  searchInText(filepath: string, content: string, pattern: string): StructuralSearchMatch[] {
    const language = detectLanguage(filepath);
    const lang = this.toAstGrepLanguage(language);
    if (!lang) {
      return [];
    }

    const root = parse(lang, content).root();
    return root.findAll({ rule: { pattern } }).map((node) => ({
      filepath,
      kind: String(node.kind()),
      text: node.text(),
      range: rangeFromOffsets(content, node.range().start.index, node.range().end.index),
    }));
  }

  createReplacementPlan(
    filepath: string,
    content: string,
    pattern: string,
    replacement: string
  ): StructuralReplacementPlan {
    const language = detectLanguage(filepath);
    const lang = this.toAstGrepLanguage(language);
    if (!lang) {
      return {
        matches: [],
        patches: [],
        fallbackReason: `ast-grep does not support ${language} in this service`,
      };
    }

    const root = parse(lang, content).root();
    const matches = root.findAll({ rule: { pattern } });
    if (matches.length === 0) {
      return {
        matches: [],
        patches: [],
        fallbackReason: `No AST match found for pattern: ${pattern}`,
      };
    }

    const searchMatches: StructuralSearchMatch[] = [];
    const patches: TextPatch[] = [];
    for (const node of matches) {
      const interpolated = this.interpolate(replacement, node);
      const edit = node.replace(interpolated);
      const range = rangeFromOffsets(content, edit.startPos, edit.endPos);
      searchMatches.push({
        filepath,
        kind: String(node.kind()),
        text: node.text(),
        range,
      });
      patches.push({
        filepath,
        range,
        oldText: content.slice(edit.startPos, edit.endPos),
        newText: edit.insertedText,
      });
    }

    return { matches: searchMatches, patches };
  }

  private interpolate(replacement: string, node: SgNode): string {
    return replacement.replace(/\${1,3}\w+/g, (match) => {
      if (match.startsWith('$$$')) {
        const name = match.slice(3);
        const m = node.getMultipleMatches(name);
        const texts = m.map((n) => n.text());
        if (texts.some((t) => t.includes(','))) {
          return texts.join('').replace(/,(?!\s)/g, ', ');
        }
        return texts.join(', ');
      } else if (match.startsWith('$')) {
        const name = match.slice(1);
        const m = node.getMatch(name);
        return m ? m.text() : match;
      }
      return match;
    });
  }

  private toAstGrepLanguage(language: CodeLanguage): Lang | undefined {
    switch (language) {
      case 'typescript':
        return Lang.TypeScript;
      case 'tsx':
      case 'jsx':
        return Lang.Tsx;
      case 'javascript':
        return Lang.JavaScript;
      case 'json':
      case 'unknown':
      default:
        return undefined;
    }
  }
}
