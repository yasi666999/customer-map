@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 订单数据合并
set "BUNDLED=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED%" (set "NODE=%BUNDLED%") else (set "NODE=node")
echo.
echo   把两个 CSV 一起拖到这个图标上（订单中心表 + 无仓订单表）
echo.
"%NODE%" "合并订单数据.js" %*
echo.
pause
