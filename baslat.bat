@echo off
chcp 65001 >nul
title Kalfa
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun, sonra bu dosyayi tekrar acin.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Bagimliliklar kuruluyor, bu ilk seferde birkac dakika surebilir...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist .env (
  call npm run setup
  if errorlevel 1 ( pause & exit /b 1 )
)

rem Tarayıcıyı sunucu açıldıktan birkaç saniye sonra aç
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
pause
