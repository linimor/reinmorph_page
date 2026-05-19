@echo off
cd /d "%~dp0"
start "" "http://127.0.0.1:8011/preview.html"
py -m http.server 8011 --bind 127.0.0.1
