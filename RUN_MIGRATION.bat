@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Running PC migration prep...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare_pc_migration.ps1"
echo.
echo If push succeeded, copy Desktop\eBay-AI-Ops-Migration-Backup to USB.
pause
