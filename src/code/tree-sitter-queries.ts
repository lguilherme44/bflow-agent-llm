import { CodeLanguage } from '../types/index.js';

export interface VersionedTreeSitterQuery {
  language: CodeLanguage;
  version: number;
  query: string;
}

export const TREE_SITTER_QUERIES: VersionedTreeSitterQuery[] = [
  {
    language: 'typescript',
    version: 1,
    query: `
      (function_declaration name: (identifier) @function.name) @function
      (lexical_declaration (variable_declarator name: (identifier) @arrow_function.name value: (arrow_function))) @arrow_function
      (class_declaration name: (type_identifier) @class.name) @class
      (interface_declaration name: (type_identifier) @interface.name) @interface
      (type_alias_declaration name: (type_identifier) @type.name) @type
      (method_definition name: (_) @method.name) @method
      (import_statement source: (string) @import.source) @import
      (export_statement declaration: (_) @export.declaration) @export
      (call_expression function: (identifier) @call.name) @call
    `,
  },
  {
    language: 'tsx',
    version: 1,
    query: `
      (function_declaration name: (identifier) @function.name) @function
      (lexical_declaration (variable_declarator name: (identifier) @arrow_function.name value: (arrow_function))) @arrow_function
      (jsx_element) @jsx_element
      (jsx_self_closing_element) @jsx_element
      (call_expression function: (identifier) @call.name) @call
    `,
  },
  {
    language: 'javascript',
    version: 1,
    query: `
      (function_declaration name: (identifier) @function.name) @function
      (lexical_declaration (variable_declarator name: (identifier) @arrow_function.name value: (arrow_function))) @arrow_function
      (class_declaration name: (identifier) @class.name) @class
      (method_definition name: (_) @method.name) @method
      (import_statement source: (string) @import.source) @import
      (export_statement) @export
      (call_expression function: (identifier) @call.name) @call
    `,
  },
  {
    language: 'json',
    version: 1,
    query: `
      (pair key: (string) @json_property.name) @json_property
    `,
  },
];
