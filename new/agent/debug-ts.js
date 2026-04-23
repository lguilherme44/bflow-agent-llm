import { TreeSitterParserService } from './dist/code/tree-sitter-parser.js';

const parser = new TreeSitterParserService();
const tsxCode = `
  import React, { useState, useEffect } from 'react';
  export const MyComponent = ({ title }: { title: string }) => {
    const [count, setCount] = useState(0);
    return <div>{title}</div>;
  };
`;
const doc = parser.parseText('test.tsx', tsxCode);
console.log('TSX Symbols:', JSON.stringify(doc.symbols, null, 2));

const jsonCode = `
{
  "name": "agent"
}
`;
const jsonDoc = parser.parseText('test.json', jsonCode);
console.log('JSON Symbols:', JSON.stringify(jsonDoc.symbols, null, 2));
