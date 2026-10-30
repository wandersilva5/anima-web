@echo off
rem ===========================================================================
rem  Abre somente o painel local (janela do Electron): conexao com a producao,
rem  numeros do acervo e sincronizacao. Nao sobe servidor web nenhum.
rem ===========================================================================
setlocal EnableExtensions
title Anima - painel
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 goto no_npm

set "SYNC=%~dp0sync"
if not exist "%SYNC%\node_modules\electron\dist\electron.exe" goto install
if not exist "%SYNC%\dist\main.js" goto build
goto run

:install
echo.
echo   Instalando as dependencias do painel (so na primeira vez).
echo.
pushd "%SYNC%"
call npm install
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail
if exist "%SYNC%\node_modules\electron\dist\electron.exe" goto build

:electron
echo.
echo   Baixando o Electron (~90 MB). Isso pode levar alguns minutos.
echo.
pushd "%SYNC%"
call node node_modules\electron\install.js
set "RC=%ERRORLEVEL%"
popd
if not exist "%SYNC%\node_modules\electron\dist\electron.exe" goto no_electron

:build
pushd "%SYNC%"
call npm run build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail

:run
pushd "%SYNC%"
call npm start
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail
exit /b 0

:no_electron
echo.
echo   ERRO: o Electron nao foi baixado (rede bloqueada ou sem conexao).
echo   Rode o atalho de novo. Se insistir, apague a pasta sync\node_modules e tente outra vez.
echo.
pause
exit /b 1

:no_npm
echo.
echo   ERRO: Node.js/npm nao encontrado no PATH.
echo   Instale o Node 18+ (nodejs.org) e rode este atalho de novo.
echo.
pause
exit /b 1

:fail
echo.
echo   O painel nao conseguiu iniciar. Veja a mensagem acima.
echo.
pause
exit /b 1
