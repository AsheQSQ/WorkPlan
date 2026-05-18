@echo off
chcp 65001 >nul
echo ========================================
echo   LocalHelper 编译脚本
echo ========================================
echo.

:: 检查 Go 是否安装
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Go 环境
    echo 请先安装 Go SDK: https://go.dev/dl/
    pause
    exit /b 1
)

echo [1/4] 检查 Go 版本...
go version

echo.
echo [2/4] 下载依赖...
go mod tidy

echo.
echo [3/4] 编译 Windows 版本...
:: 使用 CGO_ENABLED=0 静态编译
set CGO_ENABLED=0
go build -ldflags="-s -w" -o LocalHelper.exe main.go

if %errorlevel% neq 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)

echo.
echo [4/4] 编译完成!
echo 生成文件: LocalHelper.exe

echo.
echo 可选: 编译其他平台
echo   - macOS:    go build -ldflags="-s -w" -o LocalHelper_darwin main.go
echo   - Linux:   GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o LocalHelper_linux main.go

echo.
echo 按任意键退出...
pause >nul
