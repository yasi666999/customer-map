@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 客户地址 离线批量解析

set "BUNDLED=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED%" (set "NODE=%BUNDLED%") else (set "NODE=node")

echo.
echo   ============================================
echo    客户地址 离线批量解析
echo   ============================================
echo.
echo   直接把 CSV 文件拖到这个图标上，或者双击（自动选最大的 CSV）。
echo   如果只想解析某个城市，用：  --city 深圳市
echo.
"%NODE%" "批量解析大文件.js" %*
echo.
pause
