package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/localhelper/db"
	"github.com/localhelper/fileutil"
)

const WS_PORT = 18080

// Message WebSocket 消息结构
type Message struct {
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// Response 响应结构
type Response struct {
	Success bool        `json:"success"`
	Action  string      `json:"action"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// Server WebSocket 服务器
type Server struct {
	port     int
	upgrader websocket.Upgrader
	clients  map[*websocket.Conn]bool
	mutex    sync.RWMutex
}

// NewServer 创建 WebSocket 服务器
func NewServer(port int) *Server {
	return &Server{
		port: port,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // 允许所有来源（本地使用）
			},
		},
		clients: make(map[*websocket.Conn]bool),
	}
}

// Start 启动服务器
func (s *Server) Start() error {
	http.HandleFunc("/", s.handleWebSocket)
	addr := fmt.Sprintf("127.0.0.1:%d", s.port)
	log.Printf("WebSocket 服务监听端口: %d", s.port)
	go http.ListenAndServe(addr, nil)
	return nil
}

// Stop 停止服务器
func (s *Server) Stop() {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	for client := range s.clients {
		client.Close()
	}
}

// handleWebSocket 处理 WebSocket 连接
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket 连接失败: %v", err)
		return
	}

	s.mutex.Lock()
	s.clients[conn] = true
	s.mutex.Unlock()

	log.Printf("客户端已连接 (当前连接数: %d)", len(s.clients))

	defer func() {
		s.mutex.Lock()
		delete(s.clients, conn)
		s.mutex.Unlock()
		conn.Close()
		log.Printf("客户端已断开 (当前连接数: %d)", len(s.clients))
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("读取消息失败: %v", err)
			break
		}

		s.handleMessage(conn, message)
	}
}

// handleMessage 处理消息
func (s *Server) handleMessage(conn *websocket.Conn, message []byte) {
	var msg Message
	if err := json.Unmarshal(message, &msg); err != nil {
		s.sendError(conn, msg.Action, "无效的 JSON 格式")
		return
	}

	switch msg.Action {
	case "ping":
		s.sendResponse(conn, "pong", map[string]string{"status": "ok"})

	case "pick_file":
		s.handlePickFile(conn)

	case "open_file":
		var data struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			s.sendError(conn, msg.Action, "无效的数据格式")
			return
		}
		s.handleOpenFile(conn, data.ID)

	case "get_files":
		s.handleGetFiles(conn)

	case "delete_file":
		var data struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			s.sendError(conn, msg.Action, "无效的数据格式")
			return
		}
		s.handleDeleteFile(conn, data.ID)

	case "check_status":
		s.sendResponse(conn, "check_status", map[string]string{"status": "running", "version": "1.0.0"})

	default:
		s.sendError(conn, msg.Action, "未知的操作: "+msg.Action)
	}
}

// handlePickFile 处理选择文件
func (s *Server) handlePickFile(conn *websocket.Conn) {
	file, err := fileutil.PickFile()
	if err != nil {
		s.sendError(conn, "pick_file", "选择文件失败: "+err.Error())
		return
	}

	// 保存到数据库
	record := &db.FileRecord{
		ID:   file.ID,
		Name: file.Name,
		Path: file.Path,
		Size: file.Size,
	}

	if err := db.AddFile(record); err != nil {
		s.sendError(conn, "pick_file", "保存文件记录失败: "+err.Error())
		return
	}

	log.Printf("文件已添加: %s (%s)", file.Name, file.Path)
	s.sendResponse(conn, "pick_file", map[string]interface{}{
		"id":   record.ID,
		"name": record.Name,
		"path": record.Path,
		"size": record.Size,
	})
}

// handleOpenFile 处理打开文件
func (s *Server) handleOpenFile(conn *websocket.Conn, id string) {
	record, err := db.GetFile(id)
	if err != nil {
		s.sendError(conn, "open_file", "文件不存在或已被删除")
		return
	}

	if err := fileutil.OpenFile(record.Path); err != nil {
		s.sendError(conn, "open_file", "打开文件失败: "+err.Error())
		return
	}

	log.Printf("已打开文件: %s", record.Path)
	s.sendResponse(conn, "open_file", map[string]string{"path": record.Path})
}

// handleGetFiles 处理获取文件列表
func (s *Server) handleGetFiles(conn *websocket.Conn) {
	records, err := db.GetAllFiles()
	if err != nil {
		s.sendError(conn, "get_files", "获取文件列表失败: "+err.Error())
		return
	}

	s.sendResponse(conn, "get_files", map[string]interface{}{
		"files": records,
		"count": len(records),
	})
}

// handleDeleteFile 处理删除文件记录
func (s *Server) handleDeleteFile(conn *websocket.Conn, id string) {
	if err := db.DeleteFile(id); err != nil {
		s.sendError(conn, "delete_file", "删除文件记录失败: "+err.Error())
		return
	}

	log.Printf("文件记录已删除: %s", id)
	s.sendResponse(conn, "delete_file", map[string]string{"id": id})
}

// sendResponse 发送成功响应
func (s *Server) sendResponse(conn *websocket.Conn, action string, data interface{}) {
	resp := Response{
		Success: true,
		Action:  action,
		Data:    data,
	}
	conn.WriteJSON(resp)
}

// sendError 发送错误响应
func (s *Server) sendError(conn *websocket.Conn, action string, errMsg string) {
	resp := Response{
		Success: false,
		Action:  action,
		Error:   errMsg,
	}
	conn.WriteJSON(resp)
}
