@echo off
REM Run this script to vectorize your Confluence wiki and update the FAISS index
cd /d %~dp0/components
python vectorize_confluence_wiki.py
