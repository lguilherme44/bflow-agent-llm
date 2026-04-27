
import { AgentStateMachine } from './src/state/machine.js';

let state = AgentStateMachine.create('test task');
console.log('Initial messages:', state.messages);

state = AgentStateMachine.complete(state, 'final summary');
console.log('Messages after complete:', state.messages);

const finalContent = state.messages
  .filter(m => m.role === 'assistant')
  .at(-1)?.content || 'Tarefa concluída sem resposta textual.';

console.log('Final content extracted by server:', finalContent);
