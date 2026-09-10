@echo off
REM ============================================================
REM  Adaria - setup en servidor ACI (.34)
REM  1) Crea usuario Windows "asanchez" (ADMIN) pidiendo password
REM  2) Habilita TCP/IP + puerto 1433 en la instancia SQL ACIGRUP
REM  3) Abre el firewall (1433 TCP + 1434 UDP) solo desde la LAN
REM  Ejecutar como ADMINISTRADOR (clic derecho -> Ejecutar como administrador)
REM ============================================================
setlocal EnableExtensions

REM --- Autoelevacion a administrador ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Solicitando permisos de administrador...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo(
echo ============================================================
echo   1) CREAR USUARIO asanchez (ADMINISTRADOR)
echo ============================================================
echo Se te pedira una contrasena para el usuario asanchez.
net user asanchez >nul 2>&1
if %errorlevel%==0 (
  echo El usuario asanchez ya existe. Cambiando su contrasena...
  net user asanchez *
) else (
  net user asanchez * /add /fullname:"Andres Sanchez" /comment:"Admin IT"
)
REM Anadir a Administradores (ES) y Administrators (EN)
net localgroup Administradores asanchez /add >nul 2>&1
net localgroup Administrators  asanchez /add >nul 2>&1
REM Que la contrasena no caduque
wmic useraccount where "name='asanchez'" set PasswordExpires=false >nul 2>&1
echo Usuario asanchez configurado como administrador.

echo(
echo ============================================================
echo   2) HABILITAR TCP/IP + PUERTO 1433 EN INSTANCIA ACIGRUP
echo ============================================================
set "SQLINST="
REM Buscar el nombre interno de la instancia ACIGRUP (vista 64 y 32 bits)
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL" /v ACIGRUP 2^>nul ^| findstr /i ACIGRUP') do set "SQLINST=%%B"
if not defined SQLINST for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL" /v ACIGRUP 2^>nul ^| findstr /i ACIGRUP') do set "SQLINST=%%B"

if not defined SQLINST (
  echo [AVISO] No se encontro la instancia ACIGRUP en el registro.
  echo Habilitalo a mano en SQL Server Configuration Manager y reinicia el servicio.
  goto FIREWALL
)
echo Instancia interna detectada: %SQLINST%

set "BASE=HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\%SQLINST%\MSSQLServer\SuperSocketNetLib"
reg query "%BASE%" >nul 2>&1 || set "BASE=HKLM\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\%SQLINST%\MSSQLServer\SuperSocketNetLib"

reg add "%BASE%\Tcp" /v Enabled /t REG_DWORD /d 1 /f
reg add "%BASE%\Tcp\IPAll" /v TcpPort /t REG_SZ /d "1433" /f
reg add "%BASE%\Tcp\IPAll" /v TcpDynamicPorts /t REG_SZ /d "" /f
echo TCP/IP habilitado y puerto fijado a 1433.

echo Reiniciando el servicio SQL (MSSQL$ACIGRUP)...
net stop  "MSSQL$ACIGRUP" >nul 2>&1
net start "MSSQL$ACIGRUP" >nul 2>&1
if %errorlevel% NEQ 0 (
  echo [AVISO] No pude reiniciar "MSSQL$ACIGRUP" por nombre. Servicios instalados:
  sc query type= service state= all | findstr /i "MSSQL SQL"
)
REM SQL Browser (para instancias con nombre)
sc config SQLBrowser start= auto >nul 2>&1
net start SQLBrowser >nul 2>&1

:FIREWALL
echo(
echo ============================================================
echo   3) FIREWALL (1433 TCP + 1434 UDP, solo LAN 192.168.1.0/24)
echo ============================================================
netsh advfirewall firewall delete rule name="SQL ACIGRUP 1433 LAN" >nul 2>&1
netsh advfirewall firewall add rule name="SQL ACIGRUP 1433 LAN" dir=in action=allow protocol=TCP localport=1433 remoteip=192.168.1.0/24
netsh advfirewall firewall delete rule name="SQL Browser 1434 LAN" >nul 2>&1
netsh advfirewall firewall add rule name="SQL Browser 1434 LAN" dir=in action=allow protocol=UDP localport=1434 remoteip=192.168.1.0/24
echo Reglas de firewall creadas.

echo(
echo ============================================================
echo   COMPROBACION: puertos a la escucha
echo ============================================================
netstat -an | findstr ":1433"
echo(
echo HECHO. Avisa a Andres/IT para verificar 192.168.1.34:1433 desde el CT.
echo(
pause
