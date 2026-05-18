package fileutil

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/skratchdot/open-golang/open"
)

// FileInfo 文件信息
type FileInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// PickFile 打开系统文件选择对话框
func PickFile() (*FileInfo, error) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		// Windows: 使用 PowerShell 打开文件选择对话框
		psScript := `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择文件'
$dialog.Multiselect = $false
$dialog.ShowHelp = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $file = Get-Item $dialog.FileName
    @{
        Name = $file.Name
        Path = $file.FullName
        Size = $file.Length
    } | ConvertTo-Json -Compress
} else {
    Write-Output 'CANCEL'
}
`
		cmd = exec.Command("powershell", "-NoProfile", "-Command", psScript)

	case "darwin":
		// macOS: 使用 osascript 打开文件选择对话框
		cmd = exec.Command("osascript", "-e",
			`set f to choose file with prompt "选择文件"
return POSIX path of f`)

	case "linux":
		// Linux: 尝试使用 zenity 或其他工具
		cmd = exec.Command("zenity", "--file-selection", "--file-filter=*")
	}

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("文件选择失败: %v", err)
	}

	path := strings.TrimSpace(string(output))
	if path == "CANCEL" || path == "" {
		return nil, fmt.Errorf("用户取消了选择")
	}

	return getFileInfo(path)
}

// PickFiles 打开系统多文件选择对话框
func PickFiles() ([]*FileInfo, error) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		psScript := `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择文件'
$dialog.Multiselect = $true
$dialog.ShowHelp = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $files = @()
    foreach ($f in $dialog.FileNames) {
        $file = Get-Item $f
        $files += @{
            Name = $file.Name
            Path = $file.FullName
            Size = $file.Length
        }
    }
    $files | ConvertTo-Json -Compress
} else {
    Write-Output 'CANCEL'
}
`
		cmd = exec.Command("powershell", "-NoProfile", "-Command", psScript)

	case "darwin":
		cmd = exec.Command("osascript", "-e",
			`set f to choose file with prompt "选择文件" with multiple selections allowed
set result to ""
repeat with file_path in f
    set result to result & POSIX path of file_path & "
"
end repeat
return result`)

	case "linux":
		cmd = exec.Command("zenity", "--file-selection", "--multiple", "--file-filter=*")
	}

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("文件选择失败: %v", err)
	}

	pathStr := strings.TrimSpace(string(output))
	if pathStr == "CANCEL" || pathStr == "" {
		return nil, fmt.Errorf("用户取消了选择")
	}

	var files []*FileInfo
	switch runtime.GOOS {
	case "windows", "darwin":
		lines := strings.Split(pathStr, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" {
				if info, err := getFileInfo(line); err == nil {
					files = append(files, info)
				}
			}
		}
	default:
		if info, err := getFileInfo(pathStr); err == nil {
			files = append(files, info)
		}
	}

	return files, nil
}

// OpenFile 使用系统默认应用打开文件
func OpenFile(path string) error {
	// 先检查文件是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在: %s", path)
	}

	// 使用 open-golang 库打开文件
	err := open.Start(path)
	if err != nil {
		return fmt.Errorf("打开文件失败: %v", err)
	}

	return nil
}

// getFileInfo 获取文件信息
func getFileInfo(path string) (*FileInfo, error) {
	file, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	// 生成唯一 ID: 时间戳 + 随机字符
	id := fmt.Sprintf("file_%d_%s",
		time.Now().UnixNano(),
		strings.ReplaceAll(filepath.Base(path), " ", "")[:8])

	return &FileInfo{
		ID:   id,
		Name: file.Name(),
		Path: path,
		Size: file.Size(),
	}, nil
}

// FileExists 检查文件是否存在
func FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// GetFileSize 获取文件大小
func GetFileSize(path string) (int64, error) {
	file, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return file.Size(), nil
}
