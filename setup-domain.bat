@echo off
REM Setup custom local domain name

echo ====================================
echo Custom Domain Setup
echo ====================================
echo.

REM Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set LOCAL_IP=%%a
    goto :found
)

:found
set LOCAL_IP=%LOCAL_IP:~1%

echo Your PC IP: %LOCAL_IP%
echo.

REM Ask for custom domain
set /p DOMAIN="Enter custom domain (e.g., voice-assistant.local): "

if "%DOMAIN%"=="" (
    echo No domain entered. Using default: voice-assistant.local
    set DOMAIN=voice-assistant.local
)

echo.
echo Setting up domain: %DOMAIN% -> %LOCAL_IP%
echo.

REM Update Windows hosts file (requires admin)
echo Adding to C:\Windows\System32\drivers\etc\hosts...
echo %LOCAL_IP% %DOMAIN% >> C:\Windows\System32\drivers\etc\hosts

REM Update docker-compose.yml
echo Updating docker-compose.yml...
powershell -Command "(gc docker-compose.yml) -replace 'https://192\.168\.[0-9]+\.[0-9]+', 'https://%DOMAIN%' | Out-File -encoding ASCII docker-compose.yml.tmp; Move-Item -Force docker-compose.yml.tmp docker-compose.yml"

REM Update SSL certificate
echo.
echo Regenerating SSL certificate with domain name...

cd certs 2>nul || mkdir certs
cd certs

REM Create OpenSSL config with domain
(
echo [req]
echo default_bits = 2048
echo prompt = no
echo default_md = sha256
echo distinguished_name = dn
echo x509_extensions = v3_req
echo.
echo [dn]
echo C = US
echo ST = State
echo L = City
echo O = Voice Assistant
echo OU = Development
echo CN = %DOMAIN%
echo.
echo [v3_req]
echo subjectAltName = @alt_names
echo.
echo [alt_names]
echo DNS.1 = %DOMAIN%
echo DNS.2 = localhost
echo IP.1 = %LOCAL_IP%
echo IP.2 = 127.0.0.1
) > openssl.cnf

openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -config openssl.cnf 2>nul

cd ..

echo.
echo ====================================
echo Setup Complete!
echo ====================================
echo.
echo Domain: %DOMAIN%
echo Points to: %LOCAL_IP%
echo.
echo Access from PC:
echo   https://%DOMAIN%
echo   https://localhost
echo.
echo For MOBILE ACCESS:
echo ================
echo You need to add the domain to your mobile's hosts file:
echo.
echo Android (requires root):
echo   1. Install "Hosts Editor" app
echo   2. Add entry: %LOCAL_IP% %DOMAIN%
echo.
echo iOS (no root needed):
echo   1. Install "DNS Override" app
echo   2. Add custom DNS entry: %DOMAIN% -> %LOCAL_IP%
echo.
echo OR EASIER: Use the mDNS option with .local domain
echo    Access via: https://YOUR-PC-NAME.local
echo.
echo Don't forget to:
echo   1. Install the new certificate on mobile (certs\cert.pem)
echo   2. Restart Docker: manage.bat restart
echo.
pause
