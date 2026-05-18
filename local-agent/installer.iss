; LocalHelper Inno Setup Script
; 用于打包 Windows 安装程序

#define MyAppName "LocalHelper"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "LocalHelper"
#define MyAppExeName "LocalHelper.exe"
#define MyAppProtocol "localhelper"

[Setup]
; 基本信息
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
; 输出文件名
OutputDir=..\dist
OutputBaseFilename=LocalHelper_Setup_v{#MyAppVersion}
; 压缩设置
Compression=lzma2/ultra
SolidCompression=yes
; 权限
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; 其他设置
WizardStyle=modern
SetupIconFile=
UninstallDisplayIcon={app}\{#MyAppExeName}
; 版本信息
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=本地文件助手 - 安全的本地文件管理系统
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "开机自动启动"; GroupDescription: "运行方式:"

[Files]
; 主程序
Source: "LocalHelper.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; 注册自定义协议处理器
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}"; ValueType: string; ValueName: ""; ValueData: "URL:{#MyAppProtocol} Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}\shell"; ValueType: string; ValueName: ""; ValueData: "open"
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}\shell\open"; ValueType: string; ValueName: ""; ValueData: "打开 {#MyAppName}"
Root: HKCU; Subkey: "Software\Classes\{#MyAppProtocol}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Run]
; 安装后启动
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// 检查是否已安装
function IsAppInstalled(): Boolean;
begin
  Result := RegKeyExists(HKCU, 'Software\Classes\{#MyAppProtocol}');
end;

procedure CurStepAfterInstall(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // 安装完成后可以执行额外操作
    Log('LocalHelper 安装完成');
  end;
end;
