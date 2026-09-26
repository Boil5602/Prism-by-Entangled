@echo off
rem Sign the Firefox build with Mozilla (AMO, unlisted channel) -> dist\prism-veil-firefox-<ver>.xpi
rem Credentials: %USERPROFILE%\.prism\amo.env with AMO_JWT_ISSUER=... and AMO_JWT_SECRET=...
rem (generate at https://addons.mozilla.org/developers/addon/api/key/ ; never in the repo)
setlocal
cd /d "%~dp0"
if not exist "%USERPROFILE%\.prism\amo.env" ( echo missing %USERPROFILE%\.prism\amo.env & exit /b 1 )
for /f "usebackq tokens=1,* delims==" %%a in ("%USERPROFILE%\.prism\amo.env") do set "%%a=%%b"
if "%AMO_JWT_ISSUER%"=="" ( echo AMO_JWT_ISSUER not set & exit /b 1 )
for /f "usebackq delims=" %%v in (`node -p "require('./manifest.json').version"`) do set "VER=%%v"
call node build-firefox.mjs firefox --no-zip || exit /b 1
call npx --yes web-ext sign --source-dir dist\firefox --artifacts-dir dist --channel unlisted --api-key "%AMO_JWT_ISSUER%" --api-secret "%AMO_JWT_SECRET%" || exit /b 1
for %%f in ("dist\*-%VER%.xpi") do if /i not "%%~nxf"=="prism-veil-firefox-%VER%.xpi" move /y "%%f" "dist\prism-veil-firefox-%VER%.xpi" >nul
echo signed: dist\prism-veil-firefox-%VER%.xpi
