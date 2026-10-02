; ============================================================================
; Nova Client 고정 부트스트랩  ->  NovaClient-Setup.exe
;
; 왜 이게 있나:
;   Windows SmartScreen 평판은 "파일 해시" 단위로 쌓인다. 런처를 새로 배포할 때마다
;   설치 파일 내용이 바뀌면 해시가 바뀌고 평판이 매번 0으로 초기화된다. 그래서
;   유저가 브라우저로 직접 받는 파일은 이 부트스트랩 하나로 고정하고, 진짜 설치
;   파일은 이 프로그램이 대신 받아서 조용히(/S) 실행한다.
;
; ★ 이 안에는 버전 정보가 하나도 없다. 주소도 "latest" 뿐이라 런처를 아무리 새로
;   배포해도 이 exe는 다시 만들 필요가 없고, 해시가 영원히 같다 -> 평판이 계속
;   누적된다. 절대 다시 컴파일하지 말 것.
;
; 24-170차 (지금 모습):
;   · "다운로드 중일 때 그거에 따라 시계가 움직이는 게 아니라 현실 시간으로"
;     -> 시계가 진짜 벽시계가 됐다. 시/분/초 조합은 43200가지라 예전처럼 바늘 그림을
;        미리 구울 수 없어서(24-168차는 60장), 바늘을 GDI 로 직접 그린다.
;        문자판(dial.bmp)만 4배 크기로 구워두고, 그 위에 4배로 바늘을 그린 뒤 280 으로
;        줄여서 화면에 올린다(StretchBlt HALFTONE) - GDI 는 선을 부드럽게 못 그리는데
;        크게 그렸다 줄이면 매끄럽게 나온다. 삼각함수는 trig.bin(1도 단위 표)로 대신한다.
;   · "그 앱이 안움직여 화면에서 끌어도" -> 제목표시줄이 없는 창이라 끌 수가 없었다.
;     마우스 왼쪽 버튼이 눌린 채로 창 위에 있으면 WM_NCLBUTTONDOWN(HTCAPTION)을 보내서
;     윈도우 기본 "창 옮기기"에 넘긴다(OnUiTick).
;   · "최소화 눌러도 에니메이션도 안나오고 꺼지고" -> 작업표시줄 단추가 안 생겨서
;     최소화하면 되찾을 수가 없었다. WS_EX_APPWINDOW 는 "다음에 창을 보여줄 때" 반영되는
;     값이라 이미 보이는 창에는 안 먹는다 -> 숨겼다 다시 보여서 확정시키고, 최소화도
;     ShowWindow 대신 WM_SYSCOMMAND/SC_MINIMIZE 로 보내 윈도우가 직접 처리하게 한다.
;   · "X 눌렀을 때 확인 메시지도 좀 주고" -> 닫기에 예/아니오 확인을 붙였다.
;   · "우리 클라이언트 색처럼 초록색을 메인으로 하고 별도 좀 클라이언트 로고 별 써줘"
;     -> 런처 기본 테마색(#5FE066 / 배경 #0C0E14), 별은 로고의 네 갈래 반짝이 모양.
;
; 흐름:
;   1) latest.yml 을 받아 설치 파일 크기를 알아낸다(진행률 계산용)
;   2) curl.exe 를 창 없이 띄워 설치 파일을 받고, 받는 동안 파일 크기를 재서 진행률 표시
;      (curl 이 없거나 실행 실패면 urlmon 으로 동기 다운로드 - 진행률 없이 통으로)
;   3) 받은 설치 파일을 /S 로 실행 (화면에 안 뜸)
;   4) 잠깐 "설치가 끝났어요"를 보여주고 종료. 임시 파일은 NSIS 가 알아서 지운다
; ============================================================================

Unicode true
SetCompressor /SOLID lzma

!include nsDialogs.nsh
!include LogicLib.nsh
!include WinMessages.nsh
!include FileFunc.nsh
!include x64.nsh
!include StrFunc.nsh
${StrLoc}

Name "Nova Client"
Caption "Nova Client"
OutFile "NovaClient-Setup.exe"
Icon "icon.ico"
RequestExecutionLevel user
XPStyle on
BrandingText " "
ShowInstDetails nevershow

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "Nova Client"
VIAddVersionKey "FileDescription" "Nova Client 설치 도우미"
VIAddVersionKey "CompanyName"     "Nova Client"
VIAddVersionKey "LegalCopyright"  "Nova Client"
VIAddVersionKey "FileVersion"     "1.0.0.0"
VIAddVersionKey "ProductVersion"  "1.0.0.0"

!define SETUP_URL    "https://github.com/Sil2ntium7012/nova-client/releases/latest/download/NovaClient-Setup.exe"
!define YML_URL      "https://github.com/Sil2ntium7012/nova-client/releases/latest/download/latest.yml"
!define RELEASES_URL "https://github.com/Sil2ntium7012/nova-client/releases/latest"

!define WIN_W 960
!define WIN_H 600

; 창 스타일: WS_POPUP|WS_VISIBLE|WS_CLIPCHILDREN|WS_SYSMENU|WS_MINIMIZEBOX
; 24-129차: WS_SYSMENU/WS_MINIMIZEBOX 가 없으면 윈도우가 이 창을 "최소화할 수 있는 창"으로
; 보지 않아서 최소화 애니메이션이 안 나온다. WS_CAPTION 은 여전히 없으므로 제목표시줄은 안 생김
!define NOVA_STYLE 0x920A0000

; 색 (SetCtlColors 는 0xRRGGBB)
; ⚠️ C_BG 는 창 전체 색이자 "모든 라벨의 배경색"이다. makebg.py 의 BG 와 반드시 같아야 한다
!define C_BG      0x0C0E14   ; 런처 --bg-0
!define C_TEXT    0xE4F2E7   ; 상태 문구
!define C_X       0x8FA396   ; 창 버튼 글자
!define C_VER     0x6D8A76   ; 버전 글씨

; 시계 (makebg.py 의 CLOCK_* / BIG 과 반드시 일치)
!define CLOCK_BOX 280        ; 화면에 올라가는 한 변
!define CLOCK_X   340        ; 창 안에서의 좌상단 (CLOCK_CX - CLOCK_BOX/2)
!define CLOCK_Y   110        ; (CLOCK_CY - CLOCK_BOX/2)
!define BIG       1120       ; 그리는 캔버스 한 변 (= CLOCK_BOX * 4)
!define BIGC      560        ; 그 한가운데

; 바늘 치수 - 전부 4배 좌표 기준. W_* 는 "반쪽" 두께
!define H_LEN 224
!define H_TAIL 48
!define H_WB 13
!define H_WT 7
!define M_LEN 352
!define M_TAIL 64
!define M_WB 11
!define M_WT 4
!define S_LEN 416
!define S_TAIL 92
!define S_WB 4
!define S_WT 3

; GDI 색은 COLORREF = 0x00BBGGRR (RGB 를 뒤집어 적는다)
!define CR_HOUR 0xE6F2E2     ; #E2F2E6  연한 흰초록
!define CR_MIN  0x66E05F     ; #5FE066  런처 --accent
!define CR_SEC  0x82FF7B     ; #7BFF82  --accent-strong
!define CR_HUBO 0x1F2A1A     ; 가운데 축 바깥
!define CR_HUBI 0xEFFFEA     ; 가운데 축 안쪽

!define SS_CENTER_  0x00000001
!define SS_RIGHT_   0x00000002
!define SS_NOTIFY_  0x00000100

!ifndef STM_SETIMAGE
  !define STM_SETIMAGE 0x0172
!endif
!ifndef WM_NCLBUTTONDOWN
  !define WM_NCLBUTTONDOWN 0x00A1
!endif
!define SC_MINIMIZE 0xF020
!define HTCAPTION 2

Var Dlg
Var ImgBg
Var ImgHandle
Var LblStatus
Var LblX
Var LblMin
Var LblVer
Var Version
Var StatusBase  ; 상태 문구 본문(뒤에 "78 / 126 MB" 같은 꼬리가 붙음)
Var StatusTail
Var SetupPath
Var YmlPath
Var TotalBytes
Var ProcHandle
Var Phase
Var UsedFallback
Var LogFile
Var Ticks
Var LastSize
Var Diag

; ── 시계(GDI) ---------------------------------------------------------------
Var ImgClock      ; 시계가 올라가는 그림 컨트롤
Var ScreenDC
Var DcBig         ; 4배 캔버스 (문자판 복사 + 바늘 그리기)
Var DcSmall       ; 280 짜리 결과물
Var DcDial        ; 구워둔 문자판 원본
Var BmpBig
Var BmpSmall
Var BmpDial
Var OldBig
Var OldSmall
Var OldDial
Var OldPen
Var PenNull
Var BrHour
Var BrMin
Var BrSec
Var BrHubO
Var BrHubI
Var Pts           ; POINT[4]
Var Trig          ; 1도 단위 (sin, cos) 표
Var ClockKey      ; 같은 초면 다시 안 그린다
Var ClockReady
Var Dragging

; 바늘 하나를 그릴 때 쓰는 값들 (스택으로 6개를 넘기면 읽기 힘들어서 변수로 둔다)
Var HD_Deg
Var HD_Len
Var HD_Tail
Var HD_WB
Var HD_WT
Var HD_Br

; 24-130차: 다운로드가 왜 안 되는지 눈으로 확인할 수 있게 로그를 남긴다.
; %TEMP%\nova-bootstrap.log 에 단계별 결과와 오류 코드를 적는다.
Function Log
  Exch $R0
  Push $R1
  ClearErrors
  FileOpen $R1 "$LogFile" a
  IfErrors log_done
  FileSeek $R1 0 END
  FileWrite $R1 "$R0$\r$\n"
  FileClose $R1
  log_done:
  Pop $R1
  Pop $R0
FunctionEnd

!macro LOG text
  Push "${text}"
  Call Log
!macroend
!define LOG "!insertmacro LOG"

Page custom PageMain

; ---------------------------------------------------------------------------
; 창 자체를 테두리 없는 960x600 으로 바꾸고 화면 가운데에 놓는다
; ---------------------------------------------------------------------------
Function .onGUIInit
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i ${NOVA_STYLE})'
  ; 테두리를 없애면 작업표시줄에서 빠진다 -> WS_EX_APPWINDOW(0x40000)를 켠다
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i .r4'
  IntOp $4 $4 | 0x40000
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r4)'

  ; 24-170차: WS_EX_APPWINDOW 는 "다음에 창을 보여줄 때" 읽히는 값이라, 이미 보이는
  ; 창에 켜봐야 작업표시줄 단추가 안 생긴다. 그래서 최소화하면 창이 사라지고 되돌릴
  ; 방법이 없었다("최소화 눌러도 꺼지고"). 보이는 상태면 한 번 숨겼다 다시 보여준다.
  System::Call 'user32::IsWindowVisible(p $HWNDPARENT) i .r5'
  ${If} $5 != 0
    System::Call 'user32::ShowWindow(p $HWNDPARENT, i 0)'
    System::Call 'user32::ShowWindow(p $HWNDPARENT, i 5)'
  ${EndIf}

  System::Call 'user32::GetSystemMetrics(i 0) i .r0'
  System::Call 'user32::GetSystemMetrics(i 1) i .r1'
  IntOp $2 $0 - ${WIN_W}
  IntOp $2 $2 / 2
  IntOp $3 $1 - ${WIN_H}
  IntOp $3 $3 / 2
  ; SWP_FRAMECHANGED(0x20)|SWP_NOZORDER(0x4)|SWP_NOACTIVATE(0x10)
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r2, i r3, i ${WIN_W}, i ${WIN_H}, i 0x34)'
FunctionEnd

; ---------------------------------------------------------------------------
; 화면
; ---------------------------------------------------------------------------
Function PageMain
  ; 기본 마법사 버튼/구분선 숨기기
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}

  ; 창 크기/위치를 한 번 더 확정 (가운데 정렬)
  System::Call 'user32::GetSystemMetrics(i 0) i .r0'
  System::Call 'user32::GetSystemMetrics(i 1) i .r1'
  IntOp $2 $0 - ${WIN_W}
  IntOp $2 $2 / 2
  IntOp $3 $1 - ${WIN_H}
  IntOp $3 $3 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r2, i r3, i ${WIN_W}, i ${WIN_H}, i 0x34)'

  StrCpy $LogFile "$TEMP\nova-bootstrap.log"
  Delete "$LogFile"
  ${LOG} "=== Nova Client 설치 도우미 시작 ==="

  InitPluginsDir
  File "/oname=$PLUGINSDIR\bg.bmp" "bg.bmp"
  File "/oname=$PLUGINSDIR\dial.bmp" "dial.bmp"
  File "/oname=$PLUGINSDIR\trig.bin" "trig.bin"

  nsDialogs::Create 1018
  Pop $Dlg
  ${If} $Dlg == error
    Abort
  ${EndIf}

  ; 안쪽 대화상자를 창 전체로
  System::Call 'user32::SetWindowPos(p $Dlg, p 0, i 0, i 0, i ${WIN_W}, i ${WIN_H}, i 0x14)'
  SetCtlColors $Dlg ${C_TEXT} ${C_BG}

  ; 우주 배경
  ${NSD_CreateBitmap} 0 0 ${WIN_W} ${WIN_H} ""
  Pop $ImgBg
  ${NSD_SetImage} $ImgBg "$PLUGINSDIR\bg.bmp" $ImgHandle

  ; 24-128차: 라벨 배경을 transparent 로 두면 이미지가 아니라 "대화상자 배경색"이 비쳐서
  ; 글자 뒤에 네모가 생긴다. 24-166차부터는 창 전체가 같은 단색(C_BG)이라, 모든 라벨이
  ; 그냥 C_BG 를 배경색으로 쓰면 경계가 아예 존재하지 않는다.

  ; 위쪽 띠 오른쪽: 최소화 / 닫기
  nsDialogs::CreateControl STATIC ${DEFAULT_STYLES}|${SS_CENTER_}|${SS_NOTIFY_} 0 860 16 40 28 "—"
  Pop $LblMin
  SetCtlColors $LblMin ${C_X} ${C_BG}
  CreateFont $1 "Segoe UI" 14 400
  SendMessage $LblMin ${WM_SETFONT} $1 1
  ${NSD_OnClick} $LblMin OnMinClick

  nsDialogs::CreateControl STATIC ${DEFAULT_STYLES}|${SS_CENTER_}|${SS_NOTIFY_} 0 906 16 40 28 "✕"
  Pop $LblX
  SetCtlColors $LblX ${C_X} ${C_BG}
  SendMessage $LblX ${WM_SETFONT} $1 1
  ${NSD_OnClick} $LblX OnCloseClick

  ; 이름 아래: 받으려는 버전 - latest.yml 을 읽은 뒤 ReadTotalSize 가 채운다
  nsDialogs::CreateControl STATIC ${DEFAULT_STYLES}|${SS_CENTER_} 0 400 528 160 16 ""
  Pop $LblVer
  SetCtlColors $LblVer ${C_VER} ${C_BG}
  CreateFont $4 "Segoe UI" 9 400
  SendMessage $LblVer ${WM_SETFONT} $4 1

  ; 시계 아래: 상태 문구 (가운데 정렬)
  nsDialogs::CreateControl STATIC ${DEFAULT_STYLES}|${SS_CENTER_} 0 240 424 480 24 "설치를 준비하고 있어요"
  Pop $LblStatus
  SetCtlColors $LblStatus ${C_TEXT} ${C_BG}
  StrCpy $StatusBase "설치를 준비하고 있어요"
  StrCpy $StatusTail ""
  CreateFont $2 "Segoe UI Semibold" 12 600
  SendMessage $LblStatus ${WM_SETFONT} $2 1

  ; ── 시계 --------------------------------------------------------------------
  ${NSD_CreateBitmap} ${CLOCK_X} ${CLOCK_Y} ${CLOCK_BOX} ${CLOCK_BOX} ""
  Pop $ImgClock
  Call InitClock

  ; 배경 이미지를 맨 뒤로 (HWND_BOTTOM=1, NOSIZE|NOMOVE|NOACTIVATE=0x13)
  System::Call 'user32::SetWindowPos(p $ImgBg, p 1, i 0, i 0, i 0, i 0, i 0x13)'

  StrCpy $Phase 0
  StrCpy $Dragging 0
  ${NSD_CreateTimer} OnTick 400
  ; 시계 갱신 + 창 끌기 감지. 초침이 있어서 1초보다 촘촘해야 한다
  ${NSD_CreateTimer} OnUiTick 50

  nsDialogs::Show
  ${NSD_KillTimer} OnUiTick
  Call FreeClock
  ${NSD_FreeImage} $ImgHandle
FunctionEnd

; ---------------------------------------------------------------------------
; 시계 - 문자판은 구워둔 그림, 바늘은 여기서 GDI 로 직접 그린다
; ---------------------------------------------------------------------------
Function InitClock
  StrCpy $ClockReady 0
  StrCpy $ClockKey ""

  System::Call 'user32::GetDC(p 0) p .s'
  Pop $ScreenDC
  System::Call 'gdi32::CreateCompatibleDC(p $ScreenDC) p .s'
  Pop $DcBig
  System::Call 'gdi32::CreateCompatibleDC(p $ScreenDC) p .s'
  Pop $DcSmall
  System::Call 'gdi32::CreateCompatibleDC(p $ScreenDC) p .s'
  Pop $DcDial
  System::Call 'gdi32::CreateCompatibleBitmap(p $ScreenDC, i ${BIG}, i ${BIG}) p .s'
  Pop $BmpBig
  System::Call 'gdi32::CreateCompatibleBitmap(p $ScreenDC, i ${CLOCK_BOX}, i ${CLOCK_BOX}) p .s'
  Pop $BmpSmall
  ; LR_LOADFROMFILE(0x10) | LR_CREATEDIBSECTION(0x2000)
  System::Call 'user32::LoadImageW(p 0, t "$PLUGINSDIR\dial.bmp", i 0, i 0, i 0, i 0x2010) p .s'
  Pop $BmpDial

  ${If} $BmpBig == 0
  ${OrIf} $BmpSmall == 0
  ${OrIf} $BmpDial == 0
    ${LOG} "시계 준비 실패 (big=$BmpBig small=$BmpSmall dial=$BmpDial)"
    Return
  ${EndIf}

  System::Call 'gdi32::SelectObject(p $DcBig, p $BmpBig) p .s'
  Pop $OldBig
  System::Call 'gdi32::SelectObject(p $DcDial, p $BmpDial) p .s'
  Pop $OldDial
  ; 4배 캔버스를 280 으로 줄일 때 주변 화소를 평균내게 한다(HALFTONE=4).
  ; 이게 바로 GDI 가 못 하는 "부드러운 선"을 대신해 준다
  System::Call 'gdi32::SetStretchBltMode(p $DcSmall, i 4)'
  System::Call 'gdi32::SetBrushOrgEx(p $DcSmall, i 0, i 0, p 0)'

  ; 다각형 테두리는 안 그린다(PS_NULL=5) - 면만 칠한다
  System::Call 'gdi32::CreatePen(i 5, i 0, i 0) p .s'
  Pop $PenNull
  System::Call 'gdi32::SelectObject(p $DcBig, p $PenNull) p .s'
  Pop $OldPen
  System::Call 'gdi32::CreateSolidBrush(i ${CR_HOUR}) p .s'
  Pop $BrHour
  System::Call 'gdi32::CreateSolidBrush(i ${CR_MIN}) p .s'
  Pop $BrMin
  System::Call 'gdi32::CreateSolidBrush(i ${CR_SEC}) p .s'
  Pop $BrSec
  System::Call 'gdi32::CreateSolidBrush(i ${CR_HUBO}) p .s'
  Pop $BrHubO
  System::Call 'gdi32::CreateSolidBrush(i ${CR_HUBI}) p .s'
  Pop $BrHubI

  System::Alloc 32
  Pop $Pts            ; POINT[4]
  System::Alloc 2880
  Pop $Trig           ; 360 x (int sin, int cos), 10000배

  ; NSIS 에는 삼각함수가 없다. makebg.py 가 만들어 둔 표를 통째로 읽어 온다
  ; GENERIC_READ(0x80000000), FILE_SHARE_READ(1), OPEN_EXISTING(3)
  System::Call 'kernel32::CreateFileW(t "$PLUGINSDIR\trig.bin", i 0x80000000, i 1, i 0, i 3, i 0, i 0) p .s'
  Pop $0
  ${If} $0 == -1
    ${LOG} "trig.bin 열기 실패"
    Return
  ${EndIf}
  System::Call 'kernel32::ReadFile(p $0, p $Trig, i 2880, *i .r1, i 0)'
  System::Call 'kernel32::CloseHandle(p $0)'
  ${If} $1 != 2880
    ${LOG} "trig.bin 읽기 실패 ($1 바이트)"
    Return
  ${EndIf}

  StrCpy $ClockReady 1
  Call DrawClock
  ; 그림 컨트롤에 우리 비트맵을 물려둔다. 이후에는 비트맵 내용만 고쳐서 다시 그린다
  SendMessage $ImgClock ${STM_SETIMAGE} 0 $BmpSmall
FunctionEnd

Function FreeClock
  ${If} $ClockReady == 0
  ${AndIf} $BmpBig == 0
    Return
  ${EndIf}
  ${If} $OldBig != 0
    System::Call 'gdi32::SelectObject(p $DcBig, p $OldBig) p .s'
    Pop $0
  ${EndIf}
  ${If} $OldDial != 0
    System::Call 'gdi32::SelectObject(p $DcDial, p $OldDial) p .s'
    Pop $0
  ${EndIf}
  System::Call 'gdi32::DeleteObject(p $BmpBig)'
  System::Call 'gdi32::DeleteObject(p $BmpDial)'
  System::Call 'gdi32::DeleteObject(p $PenNull)'
  System::Call 'gdi32::DeleteObject(p $BrHour)'
  System::Call 'gdi32::DeleteObject(p $BrMin)'
  System::Call 'gdi32::DeleteObject(p $BrSec)'
  System::Call 'gdi32::DeleteObject(p $BrHubO)'
  System::Call 'gdi32::DeleteObject(p $BrHubI)'
  System::Call 'gdi32::DeleteDC(p $DcBig)'
  System::Call 'gdi32::DeleteDC(p $DcSmall)'
  System::Call 'gdi32::DeleteDC(p $DcDial)'
  System::Call 'user32::ReleaseDC(p 0, p $ScreenDC)'
  ; $BmpSmall 은 그림 컨트롤이 아직 들고 있으므로 마지막에 지운다
  System::Call 'gdi32::DeleteObject(p $BmpSmall)'
  System::Free $Pts
  System::Free $Trig
  StrCpy $ClockReady 0
FunctionEnd

; 바늘 하나. HD_* 에 값을 넣고 부른다. $R0~$R9 와 $9 만 쓴다
; (DrawClock 이 $5/$6/$7 에 시/분/초를 들고 있어서 건드리면 안 된다)
Function DrawHand
  IntOp $R2 $HD_Deg % 360
  ${If} $R2 < 0
    IntOp $R2 $R2 + 360
  ${EndIf}
  IntOp $R2 $R2 * 8
  IntOp $9 $Trig + $R2
  System::Call "*$9(i .R0, i .R1)"      ; R0 = sin*10000, R1 = cos*10000

  ; 바깥 방향 u = (sin, -cos), 수직 방향 perp = (-cos, -sin)
  IntOp $R2 $R0 * $HD_Len
  IntOp $R2 $R2 / 10000
  IntOp $R2 $R2 + ${BIGC}               ; 끝점 x
  IntOp $R3 $R1 * $HD_Len
  IntOp $R3 $R3 / 10000
  IntOp $R3 ${BIGC} - $R3               ; 끝점 y
  IntOp $R4 $R0 * $HD_Tail
  IntOp $R4 $R4 / 10000
  IntOp $R4 ${BIGC} - $R4               ; 꼬리 x
  IntOp $R5 $R1 * $HD_Tail
  IntOp $R5 $R5 / 10000
  IntOp $R5 $R5 + ${BIGC}               ; 꼬리 y

  ; 끝쪽 두 점
  IntOp $R6 $R1 * $HD_WT
  IntOp $R6 $R6 / 10000
  IntOp $R7 $R0 * $HD_WT
  IntOp $R7 $R7 / 10000
  IntOp $R8 $R2 - $R6
  IntOp $R9 $R3 - $R7
  System::Call "*$Pts(i R8, i R9)"
  IntOp $R8 $R2 + $R6
  IntOp $R9 $R3 + $R7
  IntOp $9 $Pts + 8
  System::Call "*$9(i R8, i R9)"

  ; 꼬리쪽 두 점
  IntOp $R6 $R1 * $HD_WB
  IntOp $R6 $R6 / 10000
  IntOp $R7 $R0 * $HD_WB
  IntOp $R7 $R7 / 10000
  IntOp $R8 $R4 + $R6
  IntOp $R9 $R5 + $R7
  IntOp $9 $Pts + 16
  System::Call "*$9(i R8, i R9)"
  IntOp $R8 $R4 - $R6
  IntOp $R9 $R5 - $R7
  IntOp $9 $Pts + 24
  System::Call "*$9(i R8, i R9)"

  System::Call 'gdi32::SelectObject(p $DcBig, p $HD_Br) p .s'
  Pop $9
  System::Call 'gdi32::Polygon(p $DcBig, p $Pts, i 4)'
FunctionEnd

; 지금 시각을 그린다. 같은 초면 아무것도 안 한다
Function DrawClock
  ${If} $ClockReady == 0
    Return
  ${EndIf}

  System::Call '*(i, i, i, i) p .r4'
  System::Call 'kernel32::GetLocalTime(p $4)'
  System::Call '*$4(&i2, &i2, &i2, &i2, &i2 .r5, &i2 .r6, &i2 .r7, &i2)'
  System::Free $4

  StrCpy $8 "$5:$6:$7"
  ${If} $8 == $ClockKey
    Return
  ${EndIf}
  StrCpy $ClockKey $8

  ; 문자판을 통째로 복사해서 지난 초의 바늘을 지운다 (SRCCOPY=0x00CC0020)
  System::Call 'gdi32::BitBlt(p $DcBig, i 0, i 0, i ${BIG}, i ${BIG}, p $DcDial, i 0, i 0, i 0x00CC0020)'

  ; 시침: 시*30도 + 분*0.5도
  IntOp $HD_Deg $5 % 12
  IntOp $HD_Deg $HD_Deg * 30
  IntOp $9 $6 / 2
  IntOp $HD_Deg $HD_Deg + $9
  StrCpy $HD_Len ${H_LEN}
  StrCpy $HD_Tail ${H_TAIL}
  StrCpy $HD_WB ${H_WB}
  StrCpy $HD_WT ${H_WT}
  StrCpy $HD_Br $BrHour
  Call DrawHand

  ; 분침: 분*6도 + 초*0.1도
  IntOp $HD_Deg $6 * 6
  IntOp $9 $7 / 10
  IntOp $HD_Deg $HD_Deg + $9
  StrCpy $HD_Len ${M_LEN}
  StrCpy $HD_Tail ${M_TAIL}
  StrCpy $HD_WB ${M_WB}
  StrCpy $HD_WT ${M_WT}
  StrCpy $HD_Br $BrMin
  Call DrawHand

  ; 초침: 초*6도
  IntOp $HD_Deg $7 * 6
  StrCpy $HD_Len ${S_LEN}
  StrCpy $HD_Tail ${S_TAIL}
  StrCpy $HD_WB ${S_WB}
  StrCpy $HD_WT ${S_WT}
  StrCpy $HD_Br $BrSec
  Call DrawHand

  ; 가운데 축
  System::Call 'gdi32::SelectObject(p $DcBig, p $BrHubO) p .s'
  Pop $9
  System::Call 'gdi32::Ellipse(p $DcBig, i 538, i 538, i 582, i 582)'
  System::Call 'gdi32::SelectObject(p $DcBig, p $BrHubI) p .s'
  Pop $9
  System::Call 'gdi32::Ellipse(p $DcBig, i 546, i 546, i 574, i 574)'

  ; 4배 캔버스를 280 으로 줄여서 그림 컨트롤이 들고 있는 비트맵에 옮긴다.
  ; ⚠️ 같은 비트맵을 DC 에 물린 채로 두면 그림 컨트롤이 그걸 못 그린다(GDI 는 한 번에
  ;    한 DC 에만 물릴 수 있다). 그래서 옮긴 직후 바로 풀어준다
  System::Call 'gdi32::SelectObject(p $DcSmall, p $BmpSmall) p .s'
  Pop $OldSmall
  System::Call 'gdi32::StretchBlt(p $DcSmall, i 0, i 0, i ${CLOCK_BOX}, i ${CLOCK_BOX}, p $DcBig, i 0, i 0, i ${BIG}, i ${BIG}, i 0x00CC0020)'
  System::Call 'gdi32::SelectObject(p $DcSmall, p $OldSmall) p .s'
  Pop $9
  System::Call 'gdi32::GdiFlush()'
  System::Call 'user32::InvalidateRect(p $ImgClock, p 0, i 0)'
  System::Call 'user32::UpdateWindow(p $ImgClock)'
FunctionEnd

; 24-129차: 타이머/클릭 콜백 안에서 부른 Quit 은 즉시 먹지 않는다. nsDialogs::Show 가
; 아직 메시지 루프를 돌고 있어서, Quit 이 세워둔 플래그가 처리될 기회가 없기 때문.
; (X 버튼이 눌러도 아무 반응이 없던 원인) 창에 닫기 메시지를 보내 확실히 끝낸다.
Function CloseApp
  ${NSD_KillTimer} OnTick
  ${NSD_KillTimer} OnUiTick
  ${If} $ProcHandle != 0
    System::Call 'kernel32::TerminateProcess(p $ProcHandle, i 1)'
    System::Call 'kernel32::CloseHandle(p $ProcHandle)'
    StrCpy $ProcHandle 0
  ${EndIf}
  SendMessage $HWNDPARENT ${WM_CLOSE} 0 0
FunctionEnd

; Abort 를 부르지 않으면 기본 "정말 종료할까요?" 확인 없이 그대로 종료된다
Function .onUserAbort
FunctionEnd

; 24-170차: ShowWindow(SW_MINIMIZE) 대신 시스템 명령으로 보낸다. 그래야 윈도우가
; "창을 최소화한다"는 일을 직접 처리해서 작업표시줄로 빨려 들어가는 애니메이션이 나온다
Function OnMinClick
  Pop $0
  SendMessage $HWNDPARENT ${WM_SYSCOMMAND} ${SC_MINIMIZE} 0
FunctionEnd

; 24-170차: "X 눌렀을 때 확인 메시지도 좀 주고"
Function OnCloseClick
  Pop $0
  ${If} $Phase >= 2
    ; 설치가 이미 시작된 뒤엔 중간에 끊으면 더 곤란해진다
    MessageBox MB_OK|MB_ICONINFORMATION "설치를 마무리하는 중이에요.$\r$\n잠시만 기다려주세요."
    Return
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION "Nova Client 설치를 취소할까요?$\r$\n$\r$\n받던 파일은 지워지고 설치는 진행되지 않아요." IDYES do_close
  Return
  do_close:
  Call CloseApp
FunctionEnd

; ---------------------------------------------------------------------------
; 50ms 마다: 시계 갱신 + 창 끌기
;
; 24-170차: "그 앱이 안움직여 화면에서 끌어도"
;   제목표시줄이 없는 창이라 윈도우가 "여기를 잡으면 창이 움직인다"는 걸 모른다.
;   보통은 창 procedure 를 가로채서 WM_NCHITTEST 에 HTCAPTION 을 돌려주지만, NSIS 에서
;   창 procedure 를 바꾸는 건 위험하다. 대신 왼쪽 버튼이 눌린 채로 우리 창 위에 있으면
;   그때 WM_NCLBUTTONDOWN(HTCAPTION)을 보내준다 - 윈도우가 그 자리에서 기본 "창 옮기기"
;   루프로 들어가서, 버튼을 뗄 때까지 창이 마우스를 따라온다.
; ---------------------------------------------------------------------------
Function OnUiTick
  ${If} $Dragging == 1
    Return
  ${EndIf}

  Call DrawClock

  System::Call 'user32::GetAsyncKeyState(i 1) i .r0'
  IntOp $0 $0 & 0x8000
  ${If} $0 == 0
    Return
  ${EndIf}
  ; 다른 창을 쓰는 중이면 끼어들지 않는다
  System::Call 'user32::GetForegroundWindow() p .r1'
  ${If} $1 != $HWNDPARENT
    Return
  ${EndIf}

  System::Call '*(i, i) p .r2'
  System::Call 'user32::GetCursorPos(p $2)'
  System::Call '*$2(i .r3, i .r4)'
  System::Free $2
  System::Call '*(i, i, i, i) p .r2'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p $2)'
  System::Call '*$2(i .r5, i .r6, i, i)'
  System::Free $2

  IntOp $7 $3 - $5      ; 창 안에서의 x
  IntOp $8 $4 - $6      ; 창 안에서의 y
  ${If} $7 < 0
  ${OrIf} $8 < 0
  ${OrIf} $7 >= ${WIN_W}
  ${OrIf} $8 >= ${WIN_H}
    Return
  ${EndIf}
  ; 오른쪽 위 창 버튼 자리에서는 끌지 않는다(눌러야 하니까)
  ${If} $8 < 52
  ${AndIf} $7 > 848
    Return
  ${EndIf}

  StrCpy $Dragging 1
  System::Call 'user32::ReleaseCapture()'
  ; 여기서 윈도우가 자기 루프로 들어가고, 버튼을 뗄 때까지 안 돌아온다
  SendMessage $HWNDPARENT ${WM_NCLBUTTONDOWN} ${HTCAPTION} 0
  StrCpy $Dragging 0
FunctionEnd

; 24-163차: 상태 칩은 "본문 · 꼬리(78 / 126 MB)" 형태로 합쳐서 보여준다.
Function RefreshStatus
  ${If} $StatusTail == ""
    SendMessage $LblStatus ${WM_SETTEXT} 0 "STR:$StatusBase"
  ${Else}
    SendMessage $LblStatus ${WM_SETTEXT} 0 "STR:$StatusBase  ·  $StatusTail"
  ${EndIf}
FunctionEnd

Function SetStatus
  Exch $0
  StrCpy $StatusBase $0
  Call RefreshStatus
  Pop $0
FunctionEnd

Function SetStatusTail
  Exch $0
  StrCpy $StatusTail $0
  Call RefreshStatus
  Pop $0
FunctionEnd

!macro Status text
  Push "${text}"
  Call SetStatus
!macroend
!define Status "!insertmacro Status"

; 앞뒤 공백/줄바꿈 제거
Function TrimLine
  Exch $R0
  Push $R1
  tl_lead:
    StrCpy $R1 $R0 1
    ${If} $R1 == " "
    ${OrIf} $R1 == "$\t"
      StrCpy $R0 $R0 "" 1
      Goto tl_lead
    ${EndIf}
  tl_tail:
    StrCpy $R1 $R0 1 -1
    ${If} $R1 == "$\r"
    ${OrIf} $R1 == "$\n"
    ${OrIf} $R1 == " "
    ${OrIf} $R1 == "$\t"
      StrCpy $R0 $R0 -1
      Goto tl_tail
    ${EndIf}
  Pop $R1
  Exch $R0
FunctionEnd

; ---------------------------------------------------------------------------
; 진행
; ---------------------------------------------------------------------------
Function OnTick
  ${If} $Phase == 0
    ${NSD_KillTimer} OnTick
    StrCpy $Phase 1
    Call StartDownload
    ${NSD_CreateTimer} OnTick 250
    Return
  ${EndIf}

  ${If} $Phase == 1
    Call PollDownload
    Return
  ${EndIf}
FunctionEnd

; latest.yml 에서 설치 파일 크기와 버전을 읽어 둔다(진행률 계산 / 아래쪽 버전 표시).
; 실패해도 그냥 진행한다 - 버전은 안 보이고 진행률만 MB 단위로 표시됨
Function ReadTotalSize
  StrCpy $TotalBytes 0
  StrCpy $Version ""
  StrCpy $YmlPath "$PLUGINSDIR\latest.yml"
  System::Call 'kernel32::GetTickCount()i.r1'
  StrCpy $2 "${YML_URL}?cb=$1"
  System::Call 'urlmon::URLDownloadToFileW(i 0, t r2, t "$YmlPath", i 0, i 0) i .r3'
  ${If} $3 != 0
    Return
  ${EndIf}
  ClearErrors
  FileOpen $4 "$YmlPath" r
  ${If} ${Errors}
    Return
  ${EndIf}
  loop:
    FileRead $4 $5
    ${If} ${Errors}
      Goto done
    ${EndIf}
    ; version: 1.0.1   (줄 맨 앞에서 시작하는 것만)
    ${If} $Version == ""
      StrCpy $6 $5 8
      ${If} $6 == "version:"
        StrCpy $8 $5 "" 8
        Push $8
        Call TrimLine
        Pop $Version
      ${EndIf}
    ${EndIf}
    ; size: 12345678   (files 아래 첫 번째 것)
    ${If} $TotalBytes == 0
      ${StrLoc} $6 $5 "size:" ">"
      ${If} $6 != ""
        IntOp $7 $6 + 5
        StrCpy $8 $5 "" $7
        Push $8
        Call TrimLine
        Pop $8
        StrCpy $TotalBytes $8
        IntOp $TotalBytes $TotalBytes + 0
      ${EndIf}
    ${EndIf}
    ${If} $TotalBytes != 0
    ${AndIf} $Version != ""
      Goto done
    ${EndIf}
    Goto loop
  done:
  FileClose $4
  ${If} $Version != ""
    SendMessage $LblVer ${WM_SETTEXT} 0 "STR:v$Version"
  ${EndIf}
FunctionEnd

Function StartDownload
  ${Status} "설치 파일을 받고 있어요"
  StrCpy $SetupPath "$PLUGINSDIR\NovaClient-Install.exe"
  StrCpy $UsedFallback 0
  StrCpy $ProcHandle 0
  StrCpy $Ticks 0
  StrCpy $LastSize 0
  StrCpy $Diag ""

  Call ReadTotalSize
  ${LOG} "total=$TotalBytes"

  ; 32비트 설치 파일이라 64비트 윈도우에서는 $SYSDIR 가 SysWOW64 로 돌려진다(WOW64
  ; 파일 리다이렉션). curl.exe 는 진짜 System32 에만 있으므로 리다이렉션을 꺼야 보인다
  ${DisableX64FSRedirection}
  StrCpy $R5 "$SYSDIR\curl.exe"
  ${IfNot} ${FileExists} "$R5"
    ; Sysnative 로도 한 번 더 시도 (리다이렉션이 안 꺼졌을 때의 우회로)
    StrCpy $R5 "$WINDIR\Sysnative\curl.exe"
  ${EndIf}
  ${IfNot} ${FileExists} "$R5"
    StrCpy $R5 ""
  ${EndIf}
  ${LOG} "curl=$R5"

  ${If} $R5 != ""
    StrCpy $2 '"$R5" -L -sS --fail --retry 2 --max-time 3600 -o "$SetupPath" "${SETUP_URL}"'
    Push $2
    Call StartHidden
    Pop $R6
    ${LOG} "curl start=$R6 cmd=$2"
    ${If} $R6 != 0
      ${EnableX64FSRedirection}
      Return
    ${EndIf}
    StrCpy $Diag "curl 실행 실패"
  ${EndIf}

  ; 2차: PowerShell 로 같은 일을 시켜본다 (역시 창 없이)
  StrCpy $R5 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$R5"
    System::Call 'kernel32::GetTickCount()i.r1'
    StrCpy $2 '"$R5" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ProgressPreference=$\'SilentlyContinue$\'; Invoke-WebRequest -Uri $\'${SETUP_URL}$\' -OutFile $\'$SetupPath$\'"'
    Push $2
    Call StartHidden
    Pop $R6
    ${LOG} "ps start=$R6"
    ${If} $R6 != 0
      ${EnableX64FSRedirection}
      Return
    ${EndIf}
    StrCpy $Diag "$Diag / PowerShell 실행 실패"
  ${EndIf}
  ${EnableX64FSRedirection}

  ; 마지막: 창이 잠깐 멈추더라도 urlmon 으로 통째로 받는다
  StrCpy $UsedFallback 1
  ${LOG} "fallback=urlmon (curl/PowerShell 둘 다 실행 실패)"
  ${Status} "설치 파일을 받고 있어요 (잠시만 기다려주세요)"
  Push "받는 중..."
  Call SetStatusTail
  System::Call 'user32::UpdateWindow(p $HWNDPARENT)'
  System::Call 'kernel32::GetTickCount()i.r1'
  StrCpy $2 "${SETUP_URL}?cb=$1"
  System::Call 'urlmon::URLDownloadToFileW(i 0, t r2, t "$SetupPath", i 0, i 0) i .r3'
  ${LOG} "urlmon hr=$3"
FunctionEnd

; 파일 크기 재기. 스택: 경로 -> 크기 (열지 못하면 -1)
Function FileSizeOf
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R2 -1
  ClearErrors
  FileOpen $R1 "$R0" r
  ${IfNot} ${Errors}
    FileSeek $R1 0 END $R2
    FileClose $R1
  ${EndIf}
  StrCpy $R0 $R2
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; 명령줄 하나를 "콘솔 창 없이" 비동기로 실행한다.
; 스택: 명령줄 -> (프로세스 핸들 또는 0)
; NSIS 의 Exec 은 콘솔 창이 뜨고, nsExec 은 끝날 때까지 기다려서 창이 멈춘다.
; 그래서 CreateProcess 를 CREATE_NO_WINDOW(0x08000000) 로 직접 부른다.
Function StartHidden
  Exch $R0            ; 명령줄
  Push $R1
  Push $R2
  Push $R3
  Push $R4

  System::Alloc 68
  Pop $R1             ; STARTUPINFOW (32비트에서 68바이트)
  System::Call "*$R1(i 68)"
  System::Alloc 16
  Pop $R2             ; PROCESS_INFORMATION

  System::Call 'kernel32::CreateProcessW(i 0, t R0, i 0, i 0, i 0, i 0x08000000, i 0, i 0, p R1, p R2) i .R3'
  ${If} $R3 == 0
    System::Call 'kernel32::GetLastError() i .R4'
    ${LOG} "CreateProcess 실패 err=$R4"
    StrCpy $R0 0
  ${Else}
    System::Call "*$R2(p .R4, p, i, i)"
    StrCpy $R0 $R4
    StrCpy $ProcHandle $R4
  ${EndIf}

  System::Free $R1
  System::Free $R2
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function PollDownload
  ${If} $UsedFallback == 1
    ${NSD_KillTimer} OnTick
    Call FinishDownload
    Return
  ${EndIf}

  IntOp $Ticks $Ticks + 1

  ; 받은 크기 확인 (파일을 직접 열어서 끝으로 seek - 정확함)
  StrCpy $R4 0
  ${If} ${FileExists} "$SetupPath"
    Push "$SetupPath"
    Call FileSizeOf
    Pop $R4
    ${If} $R4 < 0
      StrCpy $R4 0
      StrCpy $Diag "파일을 읽지 못함"
    ${EndIf}
  ${EndIf}
  StrCpy $LastSize $R4

  ; 1초마다 기록 (무슨 일이 일어나는지 로그로 남김)
  IntOp $R3 $Ticks % 4
  ${If} $R3 == 0
    ${LOG} "tick=$Ticks size=$R4"
  ${EndIf}

  ; 24-170차: 시계는 이제 진짜 시각을 가리키므로 진행 상황은 글자로만 알린다
  ${If} $TotalBytes > 0
    IntOp $5 $R4 / 1048576
    IntOp $6 $TotalBytes / 1048576
    ${If} $R4 < 1
      Push "연결하는 중..."
      Call SetStatusTail
    ${Else}
      Push "$5 / $6 MB"
      Call SetStatusTail
    ${EndIf}
  ${Else}
    IntOp $5 $R4 / 1048576
    Push "$5 MB"
    Call SetStatusTail
  ${EndIf}

  ; 프로세스가 끝났는지 확인 (0 = 신호됨)
  System::Call 'kernel32::WaitForSingleObject(p $ProcHandle, i 0) i .r4'
  ${If} $4 == 0
    System::Call 'kernel32::GetExitCodeProcess(p $ProcHandle, *i .r7)'
    ${LOG} "다운로드 종료 code=$7 size=$LastSize"
    ${If} $7 != 0
      StrCpy $Diag "curl 오류 코드 $7"
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p $ProcHandle)'
    StrCpy $ProcHandle 0
    ${NSD_KillTimer} OnTick
    Call FinishDownload
    Return
  ${EndIf}

  ; 24-131차: 예전 워치독은 4초만에 잘라버렸는데, GitHub 은 리다이렉트를 두 번 타느라
  ; 첫 바이트까지 몇 초 걸리는 게 정상이었다. 그래서 멀쩡히 받고 있는 걸 죽이고 urlmon
  ; 으로 넘어가 창이 통째로 멈췄음("응답 없음"). 이제는 아주 넉넉하게 90초 동안 단 1바이트도
  ; 안 들어왔을 때만 포기하고, urlmon 으로 갈아타지 않고 그냥 안내한다.
  ${If} $Ticks > 360
  ${AndIf} $R4 < 1
    ${LOG} "90초간 0바이트 - 포기"
    StrCpy $Diag "서버에서 응답이 없어요"
    ${NSD_KillTimer} OnTick
    ${If} $ProcHandle != 0
      System::Call 'kernel32::TerminateProcess(p $ProcHandle, i 1)'
      System::Call 'kernel32::CloseHandle(p $ProcHandle)'
      StrCpy $ProcHandle 0
    ${EndIf}
    Call FinishDownload
  ${EndIf}
FunctionEnd

; 24-132차: "설치 다 되면 자동실행해줘"
; 조용한 설치(/S)에서는 electron-builder 의 "설치 후 실행" 체크박스가 아예 없어서 앱이
; 저절로 뜨지 않는다. 그래서 부트스트랩이 직접 켠다.
; 설치 경로가 바뀔 수 있으니 exe -> 바탕화면 바로가기 -> 시작메뉴 바로가기 순으로 찾는다.
Function LaunchApp
  ${Status} "Nova Client를 실행하는 중이에요"

  StrCpy $R0 "$LOCALAPPDATA\Programs\Nova Client\Nova Client.exe"
  ${If} ${FileExists} "$R0"
    ${LOG} "실행: $R0"
    Exec '"$R0"'
    Return
  ${EndIf}

  StrCpy $R0 "$LOCALAPPDATA\Programs\nova-client\Nova Client.exe"
  ${If} ${FileExists} "$R0"
    ${LOG} "실행: $R0"
    Exec '"$R0"'
    Return
  ${EndIf}

  StrCpy $R0 "$DESKTOP\Nova Client.lnk"
  ${If} ${FileExists} "$R0"
    ${LOG} "실행(바탕화면 바로가기): $R0"
    ExecShell "" "$R0"
    Return
  ${EndIf}

  StrCpy $R0 "$SMPROGRAMS\Nova Client.lnk"
  ${If} ${FileExists} "$R0"
    ${LOG} "실행(시작메뉴 바로가기): $R0"
    ExecShell "" "$R0"
    Return
  ${EndIf}

  ${LOG} "자동 실행 실패 - 실행 파일을 찾지 못함"
FunctionEnd

Function FinishDownload
  StrCpy $0 0
  ${If} ${FileExists} "$SetupPath"
    ${GetSize} "$PLUGINSDIR" "/M=NovaClient-Install.exe /S=0B /G=0" $0 $1 $2
  ${EndIf}
  ${If} $0 < 1000000
    ${LOG} "실패: 받은 크기=$0 diag=$Diag"
    MessageBox MB_OK|MB_ICONEXCLAMATION "설치 파일을 받지 못했어요.$\r$\n$\r$\n인터넷 연결을 확인한 뒤 다시 시도해주세요.$\r$\n계속 안 되면 다운로드 페이지에서 직접 받을 수 있어요.$\r$\n$\r$\n자세한 기록: $LogFile"
    ExecShell "open" "${RELEASES_URL}"
    Call CloseApp
    Return
  ${EndIf}

  StrCpy $Phase 2
  Push ""
  Call SetStatusTail
  ${Status} "설치하는 중이에요"

  ; /S = 조용히 설치. 화면에 아무 창도 뜨지 않는다
  ${LOG} "설치 시작 (/S)"
  ExecWait '"$SetupPath" /S' $1
  ${LOG} "설치 종료 code=$1"
  ${If} $1 != 0
    ${Status} "설치 창을 여는 중이에요"
    ExecWait '"$SetupPath"'
  ${EndIf}

  StrCpy $Phase 3
  ${Status} "설치가 끝났어요"
  Call LaunchApp
  Sleep 700
  Call CloseApp
FunctionEnd

Section
SectionEnd
