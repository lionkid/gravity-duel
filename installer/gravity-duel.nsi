; Gravity Duel - Windows installer (NSIS 3). Built by tools/build-win.js, which passes:
;   VERSION  e.g. 1.0.0        STAGE  folder with GravityDuel.exe and the game files
;   OUTFILE  installer path    ICON   path to icon.ico
; 64-bit installer: the game itself only runs on 64-bit Windows.
Target amd64-unicode
!ifdef NOCOMPRESS
  SetCompress off             ; test builds only: keeps strings readable for checks
!else
  SetCompressor /SOLID lzma
!endif
RequestExecutionLevel admin
ManifestDPIAware true

!include "MUI2.nsh"
!include "x64.nsh"

!define APPNAME "Gravity Duel"
!define EXENAME "GravityDuel.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GravityDuel"
!define FWRULE "Gravity Duel"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1028 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1028 "FileDescription" "${APPNAME} 安裝程式"
VIAddVersionKey /LANG=1028 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "LegalCopyright" "${APPNAME}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安裝 ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "重力決定彈道的機甲對戰遊戲。$\r$\n$\r$\n可以單人對戰電腦、兩人在同一台電腦對打，或兩台電腦透過區域網路連線。$\r$\n$\r$\n安裝程式會替遊戲加入 Windows 防火牆的私人網路例外，讓同一個網路裡的玩家可以找到你的房間。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "立即開始遊戲"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "TradChinese"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} 需要 64 位元的 Windows 10 或更新版本。"
    Abort
  ${EndIf}
  SetRegView 64
  ; Per-machine install: shortcuts go to the shared Start menu and desktop.
  SetShellVarContext all
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
FunctionEnd

Section "Gravity Duel" SecMain
  SectionIn RO
  ; Stop a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM ${EXENAME}'
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\解除安裝 ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0

  ; Firewall: let other computers on private (home) and domain networks reach the game server
  ; and hear its room announcements. Public networks stay closed.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FWRULE}"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FWRULE}" dir=in action=allow program="$INSTDIR\${EXENAME}" enable=yes profile=private,domain'

  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "EstimatedSize" 90000
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM ${EXENAME}'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FWRULE}"'
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
SectionEnd
