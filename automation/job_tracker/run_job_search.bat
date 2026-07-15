@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%\..\..") do set "REPO_ROOT=%%~fI"
cd /d "%REPO_ROOT%"
if not exist "automation\job_tracker\logs" mkdir "automation\job_tracker\logs"
call .venv\Scripts\activate.bat
python automation\job_tracker\job_search.py >> automation\job_tracker\logs\job_search.log 2>&1
rem python automation\job_tracker\generate_cover_letters.py >> automation\job_tracker\logs\generate_cover_letters.log 2>&1
