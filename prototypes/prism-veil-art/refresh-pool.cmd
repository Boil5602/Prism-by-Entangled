@echo off
rem Refresh everything hosted at prism.entangled.world/veil/: grow the nature
rem pool with new CC0 / public-domain Commons photos, re-pull Wikipedia's
rem Perennial Sources list, sign both with the offline key, upload. Safe to run
rem any time (weekly via Task Scheduler is plenty). The extension never changes.
cd /d "%~dp0"
python fetch-art.py || exit /b 1
node sign-list.mjs hosted || exit /b 1
python upload-pool.py || exit /b 1
python fetch-rsp.py || exit /b 1
node sign-list.mjs hosted-cred || exit /b 1
python fetch-cred.py || exit /b 1
node sign-list.mjs hosted-cred iffy || exit /b 1
node sign-list.mjs hosted-cred sb || exit /b 1
python upload-pool.py --cred || exit /b 1
node verify-hosted.mjs https://prism.entangled.world/veil/art/ 3 || exit /b 1
node verify-hosted.mjs https://prism.entangled.world/veil/credibility/ 0 || exit /b 1
node verify-hosted.mjs https://prism.entangled.world/veil/credibility/ 0 iffy || exit /b 1
node verify-hosted.mjs https://prism.entangled.world/veil/credibility/ 0 sb || exit /b 1
echo refreshed
