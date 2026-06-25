@echo off
cd /d "%~dp0"
set "NODE_EXE=C:\Users\pains\AppData\Local\hermes\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
set "FNOS_ALLOWED_DEV_ORIGINS=192.168.0.27"
"%NODE_EXE%" "node_modules\next\dist\bin\next" dev -H 0.0.0.0 -p 3000
