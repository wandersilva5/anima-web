@echo off
rem ===========================================================================
rem  Galeria Anima - sobe o servidor local e abre no navegador.
rem
rem  Uso:
rem    iniciar.bat          usa o build que ja esta em server\public
rem    iniciar.bat build    roda "npm run build" antes de subir
rem    iniciar.bat dev      Vite com hot reload (5173) + API PHP (8080)
rem    iniciar.bat sync     abre tambem o app de sincronizacao (Electron)
rem    iniciar.bat setup    aplica o schema e cria o usuario admin
rem    iniciar.bat /?       esta ajuda
rem
rem  Requer PHP 8.2+ com a extensao gd. O php.exe pode estar no PATH ou aponte
rem  o caminho em ANIMA_PHP (ex.: setx ANIMA_PHP "C:\xampp\php\php.exe").
rem ===========================================================================
setlocal EnableExtensions
title Galeria Anima
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PUB=%ROOT%\server\public"
set "PORT=8080"
set "API=http://127.0.0.1:%PORT%"
set "DEV_URL=http://localhost:5173"
set "DEV="
set "FORCE_BUILD="
set "WITH_SYNC="
set "ACTION=start"

rem ------------------------------------------------------------- argumentos
:args
if "%~1"=="" goto args_done
if /i "%~1"=="dev"   set "DEV=1"
if /i "%~1"=="build" set "FORCE_BUILD=1"
if /i "%~1"=="sync"  set "WITH_SYNC=1"
if /i "%~1"=="setup" set "ACTION=setup"
if /i "%~1"=="/?"    goto usage
if /i "%~1"=="-h"    goto usage
if /i "%~1"=="--help" goto usage
shift
goto args
:args_done

rem ------------------------------------------------------------------- php
set "PHP="
if defined ANIMA_PHP if exist "%ANIMA_PHP%" set "PHP=%ANIMA_PHP%"
if not defined PHP for %%I in (php.exe) do set "PHP=%%~$PATH:I"
if not defined PHP call :auto_php
if not defined PHP goto no_php

echo.
echo   PHP .... %PHP%
echo   Site ... %ROOT%

rem ---------------------------------------------------------------- .env
if not exist "%ROOT%\server\.env" goto first_run

if /i "%ACTION%"=="setup" goto setup

rem ---------------------------------------------------------------- build
if defined FORCE_BUILD goto do_build
if defined DEV goto build_ok
if exist "%PUB%\index.html" goto build_ok

:do_build
where npm >nul 2>nul
if errorlevel 1 goto no_npm
echo.
echo   Gerando o frontend (npm run build)...
pushd "%ROOT%\app"
call npm run build
set "BUILD_RC=%ERRORLEVEL%"
popd
if not "%BUILD_RC%"=="0" goto build_fail
:build_ok

rem ------------------------------------------------------ porta ja ocupada
set "BUSY="
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul
if not errorlevel 1 set "BUSY=1"

rem ---------------------------------------------------------- servidor php
if defined BUSY goto php_busy
echo.
echo   Subindo o servidor PHP em %API% ...
start "Galeria Anima - servidor (feche para parar)" cmd /k ""%PHP%" -S 127.0.0.1:%PORT% -t "%PUB%" "%PUB%\index.php""

echo   Aguardando o servidor responder...
call :wait_http "%API%/api/health" 40
if not "%WAIT_RC%"=="0" goto server_down
call :probe_status "%API%/api/auth/me"
if "%PROBE_STATUS%"=="500" goto db_missing
goto php_ready

:php_busy
rem Servidor ja no ar (instancia anterior). Em dev seguimos para o Vite.
if defined DEV goto php_ready
goto port_busy

:php_ready
if defined DEV goto start_vite

echo.
echo   Pronto: %API%
echo.
echo   Para parar, feche a janela "Galeria Anima - servidor".
echo   Se o login falhar, rode:  iniciar.bat setup
echo.
start "" "%API%"
goto maybe_sync

rem ------------------------------------------------------------------- dev
:start_vite
where npm >nul 2>nul
if errorlevel 1 goto no_npm
echo.
echo   Subindo o Vite (hot reload) em %DEV_URL% ...
start "Galeria Anima - vite (feche para parar)" cmd /k "cd /d "%ROOT%\app" && call npm run dev"
call :wait_http "%DEV_URL%" 60
if not "%WAIT_RC%"=="0" goto vite_down
echo.
echo   Pronto: %DEV_URL%  (API em %API%)
echo.
echo   Para parar, feche as janelas "Galeria Anima - servidor" e "- vite".
echo.
start "" "%DEV_URL%"
goto maybe_sync

rem ------------------------------------------------------------- sincronizar
:maybe_sync
if not defined WITH_SYNC goto done
where npm >nul 2>nul
if errorlevel 1 goto no_npm
if not exist "%ROOT%\sync\node_modules" goto no_sync_deps
echo.
echo   Abrindo o app de sincronizacao...
start "Anima Gallery Sync" cmd /k "cd /d "%ROOT%\sync" && call npm start"
goto done

rem ------------------------------------------------------------------ setup
:setup
echo.
echo   Aplicando o schema e criando o usuario admin.
echo.
"%PHP%" "%ROOT%\server\app\cli\migrate.php"
if errorlevel 1 goto setup_fail
echo.
set "ADMIN_USER="
set /p "ADMIN_USER=Usuario admin: "
if not defined ADMIN_USER goto setup_fail
"%PHP%" "%ROOT%\server\app\cli\create_admin.php" "%ADMIN_USER%"
if errorlevel 1 goto setup_fail
echo.
echo   Anote o SYNC_TOKEN acima e cole no app de sincronizacao.
pause
exit /b 0

rem ------------------------------------------------------- rotinas internas
:wait_http
rem %1 = url, %2 = tentativas de 400ms. Seta WAIT_RC (0 = respondeu).
set "WAIT_URL=%~1"
set "WAIT_N=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%WAIT_URL%';$c=1;for($i=0;$i -lt %WAIT_N%;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u;if($r.StatusCode -lt 400){$c=0;break}}catch{};Start-Sleep -Milliseconds 400};exit $c"
set "WAIT_RC=%ERRORLEVEL%"
goto :eof

:probe_status
rem %1 = url. Seta PROBE_STATUS com o codigo HTTP (0 = sem resposta).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=0;try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 '%~1';$s=[int]$r.StatusCode}catch{if($_.Exception.Response){$s=[int]$_.Exception.Response.StatusCode}};exit $s"
set "PROBE_STATUS=%ERRORLEVEL%"
goto :eof

:auto_php
rem php.exe fora do PATH: procura em instalacoes comuns.
for %%P in (
  "%ProgramFiles%\php\php.exe"
  "%ProgramFiles(x86)%\php\php.exe"
  "C:\php\php.exe"
  "C:\tools\php\php.exe"
  "C:\xampp\php\php.exe"
  "D:\xampp\php\php.exe"
  "E:\xampp\php\php.exe"
  "C:\wamp64\bin\php\php.exe"
  "C:\wamp\bin\php\php.exe"
) do if not defined PHP if exist %%P set "PHP=%%~P"
if defined PHP goto :eof
for /d %%D in ("C:\laragon\bin\php\php-*") do if exist "%%D\php.exe" set "PHP=%%D\php.exe"
if defined PHP goto :eof
for /d %%D in ("D:\laragon\bin\php\php-*") do if exist "%%D\php.exe" set "PHP=%%D\php.exe"
goto :eof

rem ------------------------------------------------------------------ ajuda
:usage
echo.
echo   Galeria Anima - iniciar o site localmente
echo.
echo     iniciar.bat          usa o build que ja esta em server\public
echo     iniciar.bat build    roda "npm run build" antes de subir
echo     iniciar.bat dev      Vite com hot reload (5173) + API PHP (8080)
echo     iniciar.bat sync     abre tambem o app de sincronizacao (Electron)
echo     iniciar.bat setup    aplica o schema e cria o usuario admin
echo.
echo   Requer PHP 8.2+ (com gd) e Node.js 18+. Se o php.exe nao estiver no
echo   PATH, defina:  setx ANIMA_PHP "C:\xampp\php\php.exe"
echo.
pause
exit /b 0

rem ------------------------------------------------------------------ erros
:first_run
echo.
echo   Nenhum server\.env encontrado. Criando a partir do .env.example...
copy /y "%ROOT%\server\.env.example" "%ROOT%\server\.env" >nul
echo.
echo   Preencha DB_HOST, DB_NAME, DB_USER e DB_PASS (hPanel ^> Bancos de dados)
echo   e o bloco de notas que abriu agora. Salve e rode este .bat de novo.
echo.
start "" notepad "%ROOT%\server\.env"
pause
exit /b 1

:no_php
echo.
echo   ERRO: PHP nao encontrado nesta maquina.
echo.
echo   Instale o PHP 8.2+ (xampp, laragon ou o zip de windows.php.net) e
echo   deixe o php.exe no PATH, ou defina o caminho completo:
echo       setx ANIMA_PHP "C:\xampp\php\php.exe"
echo   Feche e abra este .bat.
echo.
pause
exit /b 1

:no_npm
echo.
echo   ERRO: Node.js/npm nao encontrado no PATH.
echo   Instale o Node 18+ (nodejs.org) ou rode o build em outra maquina.
echo.
pause
exit /b 1

:build_fail
echo.
echo   ERRO: o build do frontend falhou. Veja a mensagem acima.
echo.
pause
exit /b 1

:port_busy
echo.
echo   A porta %PORT% ja esta em uso - provavelmente o site ja esta rodando.
echo   Abrindo o navegador em %API%
echo.
start "" "%API%"
timeout /t 6 >nul
exit /b 0

:server_down
echo.
echo   O servidor nao respondeu em %API%.
echo   Rode o comando abaixo em um terminal para ver o erro do PHP:
echo       "%PHP%" -S 127.0.0.1:%PORT% -t "%PUB%" "%PUB%\index.php"
echo.
pause
exit /b 1

:vite_down
echo.
echo   O Vite nao respondeu em %DEV_URL%. Veja a janela "Galeria Anima - vite".
echo.
pause
exit /b 1

:db_missing
echo.
echo   O site esta no ar, mas o MySQL respondeu erro 500.
rem Pode ser banco sem schema (rode o setup) ou MySQL parado (xampp).
echo   Rode  iniciar.bat setup  para aplicar o schema e criar o admin.
echo   Se usa xampp, confirme que o MySQL esta iniciado no painel.
echo.
start "" "%API%"
goto maybe_sync

:no_sync_deps
echo.
echo   sync\node_modules nao existe. Rode "npm install" dentro de sync\.
echo.
goto done

:setup_fail
echo.
echo   O setup parou. Confira DB_* em server\.env e o usuario informado.
echo.
pause
exit /b 1

:done
timeout /t 5 >nul
exit /b 0
