@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
git add .
git commit -m "%~1"
git push
echo.
echo Done! GitHub Pages is updating: https://newormahada-blip.github.io/Arnona_Agent/
pause
