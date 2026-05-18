package db

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// FileRecord 文件记录
type FileRecord struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Init 初始化数据库
func Init(dbPath string) error {
	var err error
	db, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return err
	}

	// 创建表
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS files (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			path TEXT NOT NULL,
			size INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	log.Println("数据库初始化成功")
	return nil
}

// Close 关闭数据库连接
func Close() {
	if db != nil {
		db.Close()
	}
}

// AddFile 添加文件记录
func AddFile(record *FileRecord) error {
	record.CreatedAt = time.Now()
	record.UpdatedAt = time.Now()

	_, err := db.Exec(
		"INSERT INTO files (id, name, path, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		record.ID, record.Name, record.Path, record.Size, record.CreatedAt.Format(time.RFC3339), record.UpdatedAt.Format(time.RFC3339),
	)
	return err
}

// GetFile 获取文件记录
func GetFile(id string) (*FileRecord, error) {
	var record FileRecord
	var createdAtStr, updatedAtStr string

	err := db.QueryRow(
		"SELECT id, name, path, size, created_at, updated_at FROM files WHERE id = ?",
		id,
	).Scan(&record.ID, &record.Name, &record.Path, &record.Size, &createdAtStr, &updatedAtStr)

	if err != nil {
		return nil, err
	}

	record.CreatedAt, _ = time.Parse(time.RFC3339, createdAtStr)
	record.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAtStr)

	return &record, nil
}

// GetAllFiles 获取所有文件记录
func GetAllFiles() ([]*FileRecord, error) {
	rows, err := db.Query("SELECT id, name, path, size, created_at, updated_at FROM files ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []*FileRecord
	for rows.Next() {
		var record FileRecord
		var createdAtStr, updatedAtStr string

		if err := rows.Scan(&record.ID, &record.Name, &record.Path, &record.Size, &createdAtStr, &updatedAtStr); err != nil {
			continue
		}

		record.CreatedAt, _ = time.Parse(time.RFC3339, createdAtStr)
		record.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAtStr)
		records = append(records, &record)
	}

	return records, nil
}

// DeleteFile 删除文件记录
func DeleteFile(id string) error {
	_, err := db.Exec("DELETE FROM files WHERE id = ?", id)
	return err
}

// UpdateFile 更新文件记录
func UpdateFile(record *FileRecord) error {
	record.UpdatedAt = time.Now()
	_, err := db.Exec(
		"UPDATE files SET name = ?, path = ?, size = ?, updated_at = ? WHERE id = ?",
		record.Name, record.Path, record.Size, record.UpdatedAt.Format(time.RFC3339), record.ID,
	)
	return err
}

// FileToJSON 将文件记录转为 JSON
func FileToJSON(record *FileRecord) string {
	data, _ := json.Marshal(record)
	return string(data)
}
