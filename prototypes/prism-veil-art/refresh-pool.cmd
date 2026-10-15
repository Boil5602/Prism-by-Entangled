@echo off
rem Refresh everything hosted at prism.entangled.world/veil/: rebuild the nature
rem pool from the hand-chosen photos in pool/, re-pull Wikipedia's
rem Perennial Sources list, sign both with the offline key, upload. Safe to run
rem any time (weekly via Task Scheduler is plenty). The extension never changes.
cd /d "%~dp0"
rem the pool is chosen by hand since 2026-10-15 ("very dull"): a refresh rebuilds from pool/ and never adds photos nobody chose
python fetch-art.py --regen || exit /b 1
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
