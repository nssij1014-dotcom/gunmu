# 순찰 근무표 (인터넷 없이 동작하는 웹 앱)

- 웹 주소: https://nssij1014-dotcom.github.io/gunmu/
- 안드로이드 앱(APK): https://github.com/nssij1014-dotcom/gunmu/releases/latest/download/gunmu.apk

이 저장소에는 프로그램만 있고 이름·전화번호·근무 자료는 없습니다.
처음 열 때 `순찰근무표_자동화.xlsx`를 고르면 그 파일과 수정 내용은 **그 기기 안(브라우저 저장소)**에만 보관되고 인터넷으로 보내지지 않습니다.

## 설치
- 안드로이드(크롬): 웹 주소를 열고 메뉴(⋮) → **홈 화면에 추가** 또는 **앱 설치**. 또는 위 APK를 내려받아 설치(설치할 때 '출처를 알 수 없는 앱' 허용).
- 아이폰(사파리): 웹 주소를 열고 공유(□↑) → **홈 화면에 추가**.

한 번 연 뒤에는 인터넷이 없어도 열립니다.

## 근무표 2 (새 앱, 기존 앱과 별개)
기존 앱과 이름·주소·저장소가 다른 새 앱입니다. 기존 앱은 그대로 두고 같이 쓸 수 있습니다.

- 웹 주소: https://nssij1014-dotcom.github.io/gunmu/v2/
- 안드로이드 앱(APK): https://github.com/nssij1014-dotcom/gunmu/releases/latest/download/gunmu2.apk (앱 이름 **근무표2**, 기존 **근무표**와 같이 설치 가능)
- Windows 프로그램: https://github.com/nssij1014-dotcom/gunmu/releases/latest/download/gunmu2-setup.exe (프로그램 이름 **근무표2**. 내려받아 실행하면 관리자 권한 없이 설치되고 바탕화면·시작 메뉴에 바로가기가 생깁니다. 'PC 보호' 창이 뜨면 추가 정보 → 실행. 기존 근무표와 같이 설치 가능)
- 소스: `v2/` (웹 앱), `win/` (Windows 프로그램 포장), `apk2/` (안드로이드 포장) (index.html, engine.js, holidays.js), 계산 시험: `node v2/test/engine.test.js`
- 설치 방법은 위와 같습니다 (크롬 → 홈 화면에 추가 / APK 설치). 처음 열면 달력에서 기준일을 고르고 20일 패턴을 입력합니다.
- 앱 안에는 이름·전화번호·근무 자료가 없고, 입력한 내용은 그 기기 안에만 저장됩니다.
- 인쇄는 Windows 프로그램이나 PC 브라우저에서 합니다. 안드로이드 앱(APK) 안에서는 인쇄 버튼이 동작하지 않으니 휴대폰 브라우저(웹 주소)를 쓰세요.
