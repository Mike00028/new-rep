@echo off
REM Voice Assistant Docker Management Script

echo ====================================
echo Voice Assistant Docker Manager
echo ====================================
echo.

if "%1"=="" goto menu
if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="scale" goto scale
if "%1"=="logs" goto logs
if "%1"=="status" goto status
if "%1"=="build" goto build
if "%1"=="buildspec" goto buildspec
if "%1"=="https" goto https
if "%1"=="domain" goto domain
if "%1"=="http" goto http
goto menu

:menu
echo Usage: manage.bat [command]
echo.
echo Commands:
echo   start     - Start all services
echo   stop      - Stop all services
echo   restart   - Restart all services
echo   scale     - Scale services (e.g., manage.bat scale stt-server=3)
echo   logs      - Show logs for all services
echo   status    - Show status of all services
echo   build     - Build/rebuild all Docker images
echo   buildspec - Build specific Docker images (e.g., manage.bat buildspec stt-server tts-server)
echo   https     - Setup HTTPS for mobile access
echo   http      - Switch to HTTP-only mode (disable SSL)
echo   domain    - Setup custom domain name (e.g., voice.local)
echo.
goto end

:start
echo Starting all services...
docker-compose up -d
echo.
echo Services started! Access at:
echo   Frontend: http://localhost:3000
echo   STT API:  http://localhost:5200
echo   TTS API:  http://localhost:5100
echo   LLM API:  http://localhost:11435
echo.
echo Run 'manage.bat logs' to see logs
echo Run 'manage.bat status' to check health
goto end

:stop
echo Stopping all services...
docker-compose down
echo Services stopped.
goto end

:restart
echo Restarting all services...
docker-compose restart
echo Services restarted.
goto end

:scale
if "%2"=="" (
    echo Usage: manage.bat scale [service]=[count]
    echo Example: manage.bat scale stt-server=3
    goto end
)
echo Scaling %2...
docker-compose up -d --scale %2
echo Service scaled.
goto end

:logs
if "%2"=="" (
    echo Showing logs for all services...
    docker-compose logs -f
) else (
    echo Showing logs for %2...
    docker-compose logs -f %2
)
goto end

:status
echo Checking service status...
docker-compose ps
echo.
echo Checking health...
docker ps --format "table {{.Names}}\t{{.Status}}"
goto end

:build
echo Building all Docker images...
docker-compose build
echo Build complete.
goto end

:buildspec
if "%2"=="" (
    echo Usage: manage.bat buildspec [service1] [service2] [service3] ...
    echo.
    echo Available services:
    echo   stt-server    - Speech-to-Text service
    echo   tts-server    - Text-to-Speech service  
    echo   llm-server    - Large Language Model service
    echo   frontend      - Next.js Frontend application
    echo.
    echo Examples:
    echo   manage.bat buildspec stt-server
    echo   manage.bat buildspec stt-server tts-server
    echo   manage.bat buildspec frontend llm-server
    goto end
)

echo Building specific Docker images...
set services=%2
shift
:buildspec_loop
if "%2"=="" goto buildspec_execute
set services=%services% %2
shift
goto buildspec_loop

:buildspec_execute
echo Building services: %services%
docker-compose build %services%
echo Build complete for: %services%
goto end

:https
echo Setting up HTTPS for mobile access...
call setup-https.bat
goto end

:http
echo Switching to HTTP-only mode...
call switch-nginx.bat http
goto end

:domain
echo Setting up custom domain name...
call setup-domain.bat
goto end

:end
