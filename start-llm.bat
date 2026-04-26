@echo off
setlocal

echo.
echo ==========================================
echo   Setup do Ambiente Ollama
echo ==========================================
echo.

:: 1. Verifica se o Ollama está instalado
where ollama >nul 2>nul
if errorlevel 1 (
    echo [X] ERRO: Ollama não encontrado no PATH.
    echo Por favor, instale em: https://ollama.ai
    pause
    exit /b
)

:: 2. Garante que o servidor está rodando
echo [?] Verificando servidor Ollama...
:check_server
curl -s http://localhost:11434/api/tags >nul 2>nul
if not errorlevel 1 goto server_ready

echo [!] Servidor não responde. Iniciando 'ollama serve'...
start /B ollama serve >nul 2>&1

:: Loop de espera (máximo 20 segundos)
set WAIT_COUNT=0
:wait_loop
timeout /t 2 >nul
set /a WAIT_COUNT=%WAIT_COUNT%+2
curl -s http://localhost:11434/api/tags >nul 2>nul
if not errorlevel 1 goto server_ready
if %WAIT_COUNT% gtr 20 goto server_timeout
echo [.] Aguardando servidor... (%WAIT_COUNT%s)
goto wait_loop

:server_timeout
echo [X] ERRO: O servidor Ollama demorou muito para iniciar.
echo Tente abrir o Ollama manualmente e execute este script novamente.
pause
exit /b

:server_ready
echo [V] Servidor Ollama está online!

:: 3. Verificação de integridade dos modelos
echo [?] Verificando integridade da biblioteca...
ollama list > "%temp%\ollama_list.txt" 2>&1
findstr /C:"bad manifest" "%temp%\ollama_list.txt" >nul
if not errorlevel 1 (
    echo.
    echo [!] AVISO: Foram detectados modelos corrompidos (bad manifest).
    echo Recomenda-se remover os modelos problemáticos com 'ollama rm [nome]'.
    echo.
)

:: 4. Verificação/Pull dos modelos necessários
:: Usamos uma abordagem simples para evitar problemas com pontos em nomes de modelos
echo [?] Verificando modelos essenciais...

:: Qwen 2.5 Coder
findstr /C:"qwen2.5-coder" "%temp%\ollama_list.txt" >nul
if errorlevel 1 (
    echo [!] Modelo qwen2.5-coder não encontrado. Baixando...
    ollama pull qwen2.5-coder
) else (
    echo [V] Modelo qwen2.5-coder pronto.
)

:: Nomic Embed
findstr /C:"nomic-embed-text" "%temp%\ollama_list.txt" >nul
if errorlevel 1 (
    echo [!] Modelo nomic-embed-text não encontrado. Baixando...
    ollama pull nomic-embed-text
) else (
    echo [V] Modelo nomic-embed-text pronto.
)

del "%temp%\ollama_list.txt"

echo.
echo [V] Ambiente pronto para uso!
echo ------------------------------------------
ollama list
echo ------------------------------------------
echo.
pause


