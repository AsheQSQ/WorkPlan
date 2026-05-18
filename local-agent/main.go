package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/localhelper/db"
	"github.com/localhelper/tray"
	"github.com/localhelper/ws"
)

const (
	VERSION     = "1.0.0"
	PROTOCOL    = "localhelper"
	WS_PORT     = 18080
	DB_PATH     = "localhelper.db"
)

func main() {
	// 确保程序只运行一个实例
	ensureSingleInstance()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("============================================")
	log.Printf("   LocalHelper v%s 启动中...", VERSION)
	log.Printf("============================================")

	// 初始化数据库
	if err := db.Init(DB_PATH); err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}
	defer db.Close()

	// 启动 WebSocket 服务
	wsServer := ws.NewServer(WS_PORT)
	if err := wsServer.Start(); err != nil {
		log.Fatalf("WebSocket 服务启动失败: %v", err)
	}
	defer wsServer.Stop()

	// 初始化系统托盘
	if err := tray.Init(PROTOCOL, VERSION); err != nil {
		log.Printf("警告: 系统托盘初始化失败: %v", err)
	}

	// 等待退出信号
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("LocalHelper 正在退出...")
}

// ensureSingleInstance 确保只有一个实例运行
func ensureSingleInstance() {
	// 在 Windows 上使用互斥锁
}
