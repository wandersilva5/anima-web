@echo off
rem ===========================================================================
rem  Publica o app (frontend compilado + backend PHP) em producao.
rem  Antes de usar, preencha "user" (e opcionalmente "password") do FTP em
rem  tools\deploy.config.json  (hPanel > Arquivos > Contas FTP).
rem ===========================================================================
setlocal EnableExtensions
title Anima - publicar em producao
cd /d "%~dp0"

if not exist "tools\deploy.config.json" goto sem_config

echo.
echo   Destino .... https://femipro.trustchoicereviews.com
echo   Enviando o frontend compilado e o backend PHP por FTPS.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy.ps1" -Build
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo   O envio terminou com erro. Leia as mensagens acima e rode de novo.
if "%RC%"=="0" echo   Envio concluido.
echo.
pause
exit /b %RC%

:sem_config
echo.
echo   Falta o arquivo tools\deploy.config.json.
echo.
echo   Copie tools\deploy.config.example.json para tools\deploy.config.json e
echo   preencha host e user do FTP (a senha pode ser digitada na hora).
echo.
pause
exit /b 1
