@echo off
echo Instalando dependencias do Bot Host...
npm install
if %errorlevel% equ 0 (
    echo.
    echo Dependencias instaladas com sucesso!
) else (
    echo.
    echo Erro ao instalar dependencias.
)
pause
