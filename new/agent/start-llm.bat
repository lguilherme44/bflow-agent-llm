@echo off
setlocal

echo 🚀 Iniciando setup do Ollama no Windows...

:: 1. Verifica se o Ollama está instalado
where ollama >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Ollama não encontrado. Por favor, instale em https://ollama.ai
    pause
    exit /b
)

:: 2. Verifica se o servidor está rodando via curl
curl -s http://localhost:11434/api/tags >nul 2>nul
if %errorlevel% neq 0 (
    echo 🕒 Iniciando servidor Ollama...
    start /B ollama serve
    timeout /t 5 >nul
)

:: 3. Pull do modelo de código (Qwen 2.5 Coder)
echo 📥 Verificando modelo de código: qwen2.5-coder...
ollama pull qwen2.5-coder

:: 4. Pull do modelo de embedding (Nomic)
echo 📥 Verificando modelo de embedding: nomic-embed-text...
ollama pull nomic-embed-text

echo ✅ Ambiente Ollama pronto para uso!
echo Modelos carregados:
ollama list

pause
