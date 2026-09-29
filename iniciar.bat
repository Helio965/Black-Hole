@echo off
rem Abre o Black Hole no navegador usando um mini servidor local (nao instala nada).
rem Os modulos JavaScript nao carregam com o index.html aberto direto do disco.
title Black Hole - servidor local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\servidor.ps1"
if errorlevel 1 pause
