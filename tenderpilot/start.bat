@echo off
rem Starts TenderPilot on this computer (Windows). Double-click this file.
chcp 65001 >nul
cd /d "%~dp0engine"
where python >nul 2>nul || (echo Python غير مثبت. ثبته من https://www.python.org/downloads/ مع تفعيل "Add python.exe to PATH" & pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
echo تجهيز المتطلبات (أول مرة فقط تأخذ دقيقة)...
pip install -q --disable-pip-version-check -e .
if not exist .env copy .env.example .env >nul
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
if "%ANTHROPIC_API_KEY%"=="" (echo ضع مفتاح Claude API في الملف %cd%\.env في السطر ANTHROPIC_API_KEY= ثم شغل مرة أخرى. & notepad .env & pause & exit /b 1)
echo TenderPilot يعمل الآن: http://localhost:8000 - لإيقافه أغلق هذه النافذة
start "" http://localhost:8000
uvicorn tenderpilot.api:app --host 127.0.0.1 --port 8000
