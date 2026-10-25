@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动海拓商业版预览版（含 Signal 窗口跟随，若旧海拓未安装则自动跳过）...
start "" "node_modules\electron\dist\electron.exe" .
