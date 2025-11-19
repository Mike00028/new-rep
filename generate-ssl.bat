@echo off
REM Generate self-signed SSL certificate for local HTTPS

echo ====================================
echo Generating SSL Certificate
echo ====================================
echo.

REM Check if OpenSSL is available
where openssl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo OpenSSL not found. Installing via Chocolatey...
    echo.
    echo Please install Chocolatey first from: https://chocolatey.org/install
    echo Then run: choco install openssl
    echo.
    pause
    exit /b 1
)

REM Create customvoiceagent directory for certificates
if not exist "customvoiceagent" mkdir customvoiceagent
cd customvoiceagent

REM Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set LOCAL_IP=%%a
    goto :found
)

:found
set LOCAL_IP=%LOCAL_IP:~1%

echo Generating certificate for IP: %LOCAL_IP%
echo.

REM Create OpenSSL config file
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
echo CN = %LOCAL_IP%
echo.
echo [v3_req]
echo subjectAltName = @alt_names
echo.
echo [alt_names]
echo IP.1 = %LOCAL_IP%
echo IP.2 = 127.0.0.1
echo DNS.1 = localhost
) > openssl.cnf

REM Generate private key and certificate
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -config openssl.cnf

echo.
echo ====================================
echo Certificate Generated!
echo ====================================
echo.
echo Files created in certs/ folder:
echo   - cert.pem (SSL certificate)
echo   - key.pem  (Private key)
echo.
echo IMPORTANT: Trust this certificate on your mobile device!
echo.
echo For Android:
echo   1. Transfer cert.pem to your phone
echo   2. Settings ^> Security ^> Install certificate
echo   3. Select cert.pem file
echo.
echo For iOS:
echo   1. AirDrop cert.pem to iPhone
echo   2. Settings ^> General ^> VPN ^& Device Management
echo   3. Install profile and trust
echo.

cd ..
pause
