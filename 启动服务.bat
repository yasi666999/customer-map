@echo off
chcp 65001 >nul
title 客户地址地图 - 本地服务
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo   还没有构建产物，先执行一次构建...
  call npm run build
)
echo.
echo   正在启动本地服务...
echo   地址：http://localhost:5173/
echo   这种方式会启用后台解析线程（Worker），大数据更流畅。
echo   关掉这个黑窗口就等于停止服务。
echo.
start "" http://localhost:5173/
npx vite preview --outDir dist --port 5173 --strictPort
pause
