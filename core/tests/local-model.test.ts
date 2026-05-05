import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { isMalformedLocalOutput, sanitizeLocalModelText } from '../agent/openai-agents/local-model.js';

describe('Local model output hygiene', () => {
  it('flags unreadable local model noise', () => {
    const noisy = [
      '@--- # @__|/_As.H - or/node--as-_h- or /- =0 oder // @- @- @- @-',
      '##.S -## --> >> of##S##.S - ## O##F##  ## ?2-> >> *##0 ->See',
      '##0##0SI##See 0 - for-T|0 of## See##0 See >> See0 -SL0 See##',
      '0##00 ->  ##  C >>## See0->0  ## ## -0##0 >>00 >>##0## startY000',
    ].join(' ');

    assert.strictEqual(isMalformedLocalOutput(noisy), true);
  });

  it('keeps normal PT-BR answers', () => {
    const answer = [
      'Ainda faltam tres pontos para fechar a migracao:',
      'validar o empacotamento do Electron no Windows,',
      'trocar os endpoints antigos pelo canal IPC/WebSocket e revisar os testes de smoke.',
    ].join(' ');

    assert.strictEqual(isMalformedLocalOutput(answer), false);
  });

  it('keeps code snippets with symbols', () => {
    const code = [
      '```ts',
      'export function sum(values: number[]) {',
      '  return values.reduce((total, value) => total + value, 0);',
      '}',
      '```',
    ].join('\n');

    assert.strictEqual(isMalformedLocalOutput(code), false);
  });

  it('removes common local-model control tokens', () => {
    assert.strictEqual(
      sanitizeLocalModelText('<|assistant|><think>rascunho</think>Resposta final.'),
      'Resposta final.'
    );
  });
});
