@echo off
REM Complete HTTPS setup for mobile access

echo ====================================
echo Voice Assistant - HTTPS Setup
echo ====================================
echo.

REM Step 1: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set LOCAL_IP=%%a
    goto :found
)

:found
set LOCAL_IP=%LOCAL_IP:~1%

echo Your PC IP: %LOCAL_IP%
echo.

REM Step 2: Update docker-compose.yml with correct IP
echo Updating configuration with IP: %LOCAL_IP%
powershell -Command "(gc docker-compose.yml) -replace 'https://192\.168\.[0-9]+\.[0-9]+', 'https://%LOCAL_IP%' | Out-File -encoding ASCII docker-compose.yml.tmp; Move-Item -Force docker-compose.yml.tmp docker-compose.yml"

REM Step 3: Generate SSL certificate
echo.
echo Generating SSL certificate...
call generate-ssl.bat

echo.
echo ====================================
echo Setup Complete!
echo ====================================
echo.
echo Next steps:
echo.
echo 1. Install the certificate on your mobile:
echo    - Copy certs\cert.pem to your phone
echo    - Android: Settings ^> Security ^> Install certificate
echo    - iOS: Settings ^> General ^> VPN ^& Device Management
echo.
echo 2. Allow firewall (run as Administrator):
echo    netsh advfirewall firewall add rule name="Voice Assistant HTTPS" dir=in action=allow protocol=TCP localport=80,443
echo.
echo 3. Start Docker:
echo    manage.bat start
echo.
echo 4. Access from mobile:
echo    https://%LOCAL_IP%
echo.
echo Note: You'll see a security warning - click "Advanced" and "Proceed"
echo This is normal for self-signed certificates.
echo.
pause
