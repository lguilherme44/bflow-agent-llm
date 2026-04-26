Write-Host "🚀 Iniciando setup do Ollama no Windows..." -ForegroundColor Cyan

# 1. Verifica se o Ollama está instalado
if (!(Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Ollama não encontrado. Por favor, instale em https://ollama.ai" -ForegroundColor Red
    exit
}

# 2. Verifica se o servidor está rodando, se não, inicia
try {
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -ErrorAction Stop
} catch {
    Write-Host " iniciando servidor Ollama..." -ForegroundColor Yellow
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 5
}

# 3. Pull do modelo de código
Write-Host "📥 Verificando modelo de código: qwen2.5-coder..." -ForegroundColor Cyan
ollama pull qwen2.5-coder

# 4. Pull do modelo de embedding
Write-Host "📥 Verificando modelo de embedding: nomic-embed-text..." -ForegroundColor Cyan
ollama pull nomic-embed-text

Write-Host "✅ Ambiente Ollama pronto para uso!" -ForegroundColor Green
ollama list
