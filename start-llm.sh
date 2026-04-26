#!/bin/bash

# start-ollama.sh - Configura e inicia o ambiente Ollama para o Agente

echo "🚀 Iniciando setup do Ollama..."

# 1. Verifica se o Ollama está instalado
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama não encontrado. Por favor, instale em https://ollama.ai"
    exit 1
fi

# 2. Tenta iniciar o servidor Ollama em segundo plano (caso não esteja rodando)
# No Windows (Git Bash/WSL), o servidor geralmente roda como um serviço, 
# mas esse comando garante a disponibilidade da API.
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo " iniciando servidor Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 5 # Espera o boot do servidor
fi

# 3. Pull do modelo de código (Qwen 2.5 Coder)
# Para 8GB de VRAM, a versão 7B é a mais recomendada.
echo "📥 Verificando modelo de código: qwen2.5-coder..."
ollama pull qwen2.5-coder

# 4. Pull do modelo de embedding (Nomic)
echo "📥 Verificando modelo de embedding: nomic-embed-text..."
ollama pull nomic-embed-text

echo "✅ Ambiente Ollama pronto para uso!"
echo "Modelos carregados:"
ollama list
