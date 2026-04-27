# Guia de Fine-Tuning do AgentOS

Este guia explica como utilizar os logs coletados pelo seu agente para treinar modelos locais mais eficientes e inteligentes.

## 1. Exportando os Dados
O AgentOS agora mantém seus logs organizados automaticamente. Para gerar o arquivo consolidado de treinamento, basta rodar o comando abaixo periodicamente (ou quando quiser treinar uma nova versão):

```powershell
npx tsx src/tools/export-dataset.ts
```

Isso gerará um arquivo em `./datasets/agent_traces_YYYY-MM-DD.jsonl` no formato de mensagens (OpenAI compatible).

## 2. Preparando o Ambiente de Treino
Recomendamos o uso do **Unsloth** para fine-tuning local, pois ele é extremamente rápido e consome pouca VRAM.

### Requisitos:
- GPU NVIDIA (8GB+ VRAM recomendado para modelos de 7B-9B).
- Python 3.10+.

### Instalação (Ubuntu/WSL):
```bash
pip install unsloth[colab-new]
pip install --no-deps xformers trl peft accelerate bitsandbytes
```

## 3. Configurando o Treinamento
Você pode usar um script simples do Unsloth para carregar o seu arquivo `.jsonl`. O segredo aqui é ensinar o modelo a preencher o raciocínio dentro das tags `<think>`.

### Dica de Ouro: "Chain-of-Thought" Fine-tuning
Como exportamos o conteúdo completo do agente (incluindo o raciocínio), o modelo aprenderá a "pensar antes de agir" automaticamente.

## 4. Usando o Modelo Treinado no AgentOS
Após o treinamento, exporte o modelo para o formato **GGUF** (o Unsloth faz isso automaticamente se solicitado).

1. Mova o arquivo `.gguf` para a pasta do seu servidor LLM (ex: LM Studio ou llama.cpp).
2. Atualize o seu arquivo `.bat` (ex: `Nemotron.bat`) para apontar para o novo arquivo do modelo.
3. Reinicie o servidor e o AgentOS.

---

## Por que fazer isso?
- **Especialização**: O modelo fica melhor em lidar com a estrutura específica do seu projeto.
- **Velocidade**: Modelos menores (como o Nemotron 9B) podem superar modelos gigantes (como o GPT-4o) em tarefas específicas após um bom fine-tuning.
- **Privacidade**: Todo o aprendizado acontece na sua máquina.
