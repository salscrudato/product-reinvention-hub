@echo off
REM File: test_confluence.bat
REM Purpose: Test Confluence API connection and authentication only (no CQL search)

REM Set variables from your .env file (update if needed)
set EMAIL=smamidala83@gmail.com
set TOKEN=ATATT3xFfGF0G0njwo1NIh-5qj0fHiL9Y58OwZxfAT_uCMyXIe2lnW-njktsgyENe-Z5tbZKc9My-6eriImBhdupNIv1Wm5OoM0wtDF1l9h8Chc6rGN6SI8qkqKwHySx0hhXMFN8cquMf5q1bh2m1PqMh5F6jLVy_kihvZtju8o4RHoUEVj5_0g=870988F6
set BASE_URL=https://smamidala.atlassian.net/wiki/rest/api

REM Use the Confluence API root endpoint for a simple auth check
set URL=%BASE_URL%/space

@echo =============================
@echo EMAIL: %EMAIL%
@echo TOKEN: (hidden)
@echo BASE_URL: %BASE_URL%
@echo URL: %URL%
@echo =============================

@echo Running curl with verbose output to test authentication...
curl -v -u "%EMAIL%:%TOKEN%" -H "Accept: application/json" "%URL%"

