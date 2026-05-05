# BFlow Agent LLM 🚀

**O cérebro autônomo para engenharia de software de elite.**

BFlow é um agente de software fundamentado no ciclo **ReAct (Observe-Think-Act-Verify)**, projetado para ser resiliente e focado em manipulação de código avançada. Ele não apenas gera texto; ele entende, planeja, executa e valida mudanças complexas em codebases reais.

Agora equipado com uma nova **Interface Visual via Electron**, o agente alcança níveis de interatividade e observabilidade inéditos.

---

## ✨ Diferenciais

- **💻 Interface Desktop (Electron)**: Chat moderno estilo ChatGPT, painel de logs em tempo real, Diff Viewer integrado para revisar mudanças de código antes de aceitar.
- **🧠 Arquitetura baseada na OpenAI Agents SDK**: Orquestração robusta baseada no SDK oficial da OpenAI para agentes, porém otimizado para rodar 100% local.
- **🌳 AST-First Development**: Manipulação de código via **Tree-sitter** e **ast-grep**. Menos regex, mais precisão semântica.
- **🔍 RAG Local Integrado**: Busca semântica e estrutural pelo workspace para injetar contexto nos LLMs de baixa VRAM.
- **🛡️ Integração de Testes e Lint**: Ferramentas nativas que o agente usa de forma autônoma para validar o que acabou de alterar.
- **🔌 Model Context Protocol (MCP)**: Integração via UI para conectar novos servidores de ferramentas dinamicamente.
- **⚡ Otimizado para VRAM Local (8GB)**: O agente unificado foi calibrado para modelos de 7B-8B rodando no LM Studio ou Ollama, evitando perda de contexto em handoffs de sub-agentes.

---

## 🛠️ Tecnologias Core

- **App GUI**: Electron, Vite, React
- **Agent Core**: `@openai/agents`, Node.js, TypeScript
- **Code Intelligence**: Tree-sitter, ast-grep, TypeScript Language Service
- **Providers Suportados**: LM Studio, Ollama, OpenAI, Anthropic

---

## 🚀 Como Iniciar

### Pré-requisitos
- Node.js (v18 a v22)
- LM Studio ou Ollama rodando localmente (ou chave da OpenAI/Anthropic)

### Instalação e Execução em Modo de Desenvolvimento
```bash
git clone https://github.com/lguilherme44/bflow-agent-llm.git
cd bflow-agent-llm
npm install
npm run dev
```

A aplicação desktop será aberta. Nas configurações (⚙️), você pode escolher o provedor (ex: LM Studio), o URL local (`http://localhost:1234/v1`) e clicar em "Sincronizar" para carregar seus modelos baixados.

### Gerando o Binário (.exe / .dmg / .AppImage)
```bash
# Para Windows:
cd electron-app
npm run build:win

# Para Mac:
cd electron-app
npm run build:mac

# Para Linux:
cd electron-app
npm run build:linux
```
O arquivo final executável ficará disponível na pasta `electron-app/dist`.

---

## 📅 Status do Projeto

A migração da interface de CLI (`vagent`) para a versão **Desktop / Electron** foi concluída com sucesso!
* O core foi refatorado para usar o padrão Swarm/Agents SDK.
* Ferramentas complexas legadas (`retrieve_context`, `run_tests`, `run_linter`) foram portadas para a nova estrutura.
* A persistência de modelo é controlada pelo painel visual e arquivo nativo JSON.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

---
*Desenvolvido com ❤️ para transformar a engenharia de software com IA.*
