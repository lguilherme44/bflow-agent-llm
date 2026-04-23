import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';

test('Tree-sitter Fixtures - TypeScript', () => {
  const parser = new TreeSitterParserService();
  const code = `
    import { x } from "./mod";
    export interface Data { id: number }
    export class Service {
      async execute(data: Data): Promise<void> {
        console.log(data.id);
      }
    }
    const internal = () => { return 1; };
  `;
  const doc = parser.parseText('test.ts', code);
  
  assert.equal(doc.language, 'typescript');
  assert.ok(doc.symbols.some(s => s.kind === 'class' && s.name === 'Service'), 'Should find class');
  assert.ok(doc.symbols.some(s => s.kind === 'method' && s.name === 'execute'), 'Should find method');
  assert.ok(doc.symbols.some(s => s.kind === 'interface' && s.name === 'Data'), 'Should find interface');
});

test('Tree-sitter Fixtures - TSX (React)', () => {
  const parser = new TreeSitterParserService();
  const code = `
    import React, { useState, useEffect } from 'react';
    
    export const MyComponent = ({ title }: { title: string }) => {
      const [count, setCount] = useState(0);
      
      useEffect(() => {
        console.log("mounted");
      }, []);

      return <div onClick={() => setCount(c => c + 1)}>{title}: {count}</div>;
    };
  `;
  const doc = parser.parseText('test.tsx', code);
  
  assert.equal(doc.language, 'tsx');
  // Check for component (arrow function)
  assert.ok(doc.symbols.some(s => s.kind === 'arrow_function' && s.name === 'MyComponent'), 'Should find component');
  // Check for hooks
  assert.ok(doc.symbols.some(s => s.kind === 'hook' && s.name === 'useState'), 'Should find useState');
  assert.ok(doc.symbols.some(s => s.kind === 'hook' && s.name === 'useEffect'), 'Should find useEffect');
  // Check for JSX
  assert.ok(doc.symbols.some(s => s.kind === 'jsx_element'), 'Should find JSX element');
});

test('Tree-sitter Fixtures - JavaScript', () => {
  const parser = new TreeSitterParserService();
  const code = `
    const { log } = require('console');
    function legacy(a, b) {
      return a + b;
    }
    module.exports = { legacy };
  `;
  const doc = parser.parseText('test.js', code);
  assert.equal(doc.language, 'javascript');
  assert.ok(doc.symbols.some(s => s.kind === 'function' && s.name === 'legacy'), 'Should find function');
});

test('Tree-sitter Fixtures - JSON', () => {
  const parser = new TreeSitterParserService();
  const code = `
    {
      "name": "agent",
      "version": "1.0.0",
      "config": {
        "enabled": true
      }
    }
  `;
  const doc = parser.parseText('test.json', code);
  assert.equal(doc.language, 'json');
  assert.ok(doc.symbols.some(s => s.kind === 'json_property' && s.name === 'name'), 'Should find name property');
  assert.ok(doc.symbols.some(s => s.kind === 'json_property' && s.name === 'config'), 'Should find config property');
});
