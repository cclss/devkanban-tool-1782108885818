# 모바일 QA 기준선 (Mobile QA Baseline)

전자계약 SaaS 모바일(반응형 웹) 적용의 **완료 여부 판단 기준**이다. 이후
Phase 1(서명자 경험) · Phase 2(발송자 조회) · Phase 3(생성 위저드)의 "Done"은
이 문서의 대상 뷰포트·실기기 매트릭스·스모크 체크리스트를 통과하는 것으로
판정한다.

이 문서는 **기준만 정의**한다. 화면 리팩터·구현·새 CSS/Token/유틸 정의·자동화
테스트 코드·CI 구성·실제 실기기 테스트 실행은 범위 밖이다. 값·유틸은 재정의하지
않고 이미 확립된 규약을 **참조**한다:

- 반응형 규약: `conventions/responsive.md` (Design Spec)
- 모바일 토대 유틸(히트 영역·safe-area·dvh): `conventions/mobile-foundations.md` (Design Spec)
- 터치 최소 크기 Token: `touch/hit-target-min = 44px` (Design Spec)
- 구현 위치: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`

> 기획서 성공 기준(요약): 서명자 플로우가 **375px~430px**에서 가로 스크롤 없이
> 완결 · 모든 인터랙티브 요소 **최소 44×44px** · 서명/OTP/문서 뷰(확대)/완료·다운로드
> 정상 동작 · **iOS Safari / Android Chrome 실기기** 스모크 통과(주소창 노출/숨김에
> 따른 레이아웃 깨짐·하단 CTA 가림 없음) · **데스크톱 회귀 없음**.

---

## 1. 대상 뷰포트 목록

성공 기준의 **375px ~ 430px 폭 대역**을 기준으로 표준 테스트 폭을 3종으로
고정한다. 각 폭은 소형·중형·대형 폰을 대표하며, 이 폭들에서 **가로 스크롤이
0(문서 전체 폭 = 뷰포트 폭)** 이어야 한다.

| 폭(CSS px) | 대표성 | 대표 기기(예시) | 검증 목적 |
|---|---|---|---|
| **375** | 소형 폰 (하한) | iPhone SE(2·3세대), iPhone 12/13 mini | 가장 좁은 폭에서 콘텐츠 넘침·줄바꿈 깨짐·CTA 겹침 확인 |
| **390** | 중형 폰 (표준) | iPhone 12/13/14, iPhone 15(393) | 가장 흔한 폭. 기본 레이아웃 기준선 |
| **430** | 대형 폰 (상한) | iPhone 14/15 Plus·Pro Max | 넓은 폭에서 상한 폭 컨테이너(`max-w-[…]`) 중앙 정렬·여백 확인 |

### 참고 — Android 하한 가드
성공 기준 대역은 375~430px이지만, Android(Galaxy 계열)는 실사용에서 **360px**가
흔하다. 375px를 통과하면 360px도 통상 통과하나, 실기기 매트릭스(§2)의 Galaxy에서
360px 폭 레이아웃 넘침을 함께 육안 확인한다. **신규 폭 기준으로 승격하지는 않으며**
보조 가드로만 둔다.

### 세로/가로(orientation)
- **세로(portrait)가 1차 대상.** 세 표준 폭은 세로 기준이다.
- **가로(landscape)**: 서명자 해피패스(§3)가 가로에서도 **깨지지 않는지**만 확인
  한다(가로 스크롤 0, 하단 고정 CTA 도달 가능). 가로 전용 최적 레이아웃은 목표가
  아니다 — "회귀·가림 없음" 수준.

### 가로 스크롤 0 기준
- 판정: 각 표준 폭에서 페이지를 좌우로 밀어도 이동이 없어야 한다
  (`document.scrollingElement.scrollWidth === clientWidth`).
- 위반 신호: 화면 밖으로 새는 요소, 고정 폭 픽셀 값, 음수 마진, 넘치는 이미지/표.
- 근거 규약: 데스크톱 고정 폭 컨테이너는 `mx-auto w-full max-w-[…]` 3종 세트로
  두어 모바일 풀폭 + 데스크톱 상한을 동시에 만족한다(`conventions/responsive.md` §1).

---

## 2. 실기기 매트릭스

브라우저 개발자도구 폭 시뮬레이션(§1)으로는 잡히지 않는 **주소창 동적
노출/숨김(dvh)** · **safe-area inset(노치·홈 인디케이터)** · **실제 터치 정확도**를
검증하기 위한 최소 실기기 조합이다. 각 기기에서 **주소창이 보이는 상태와 숨은
상태 양쪽**을 확인한다(스크롤로 툴바를 접었다 폈다 하며).

### iOS Safari

| 기기 | 폭(px) | OS/브라우저(최소) | 폼팩터 특성 | 필수 확인 |
|---|---|---|---|---|
| iPhone SE (2·3세대) | 375 | iOS 16+ / Safari | 홈 버튼, 노치 없음, **하단 safe-area = 0** | safe-area 0인 기기에서 `.pb-safe-cta`가 no-op으로 정상(과다 여백 없음) |
| iPhone 14 / 15 | 390 / 393 | iOS 17+ / Safari | 노치·다이내믹 아일랜드, **홈 인디케이터 있음** | 주소창 숨김 시 하단 CTA가 홈 인디케이터에 안 가림, dvh 추종 |
| iPhone 15 Pro Max (또는 14 Pro Max) | 430 / 428 | iOS 17+ / Safari | 대형, 홈 인디케이터 | 넓은 폭 상한 컨테이너 중앙 정렬, 가로 스크롤 0 |

### Android Chrome

| 기기 | 폭(px) | OS/브라우저(최소) | 폼팩터 특성 | 필수 확인 |
|---|---|---|---|---|
| Google Pixel (6/7 계열) | 412 | Android 13+ / Chrome | 제스처 내비게이션 바 | 주소창 노출/숨김에 따른 dvh 리사이즈, 하단 CTA 도달성 |
| Samsung Galaxy (S22/S23 계열) | 360 / 384 | Android 13+ / Chrome | 좁은 폭(360) 실사용 | 360px 폭 레이아웃 넘침 없음, 하단 제스처 바와 CTA 겹침 없음 |

### 각 기기 공통 필수 확인 — 주소창(dvh) 상태
1. **주소창 노출 상태**(진입 직후): 하단 고정 CTA가 화면 안에 있고 잘리지 않는다.
2. **주소창 숨김 상태**(위로 스크롤 후): 레이아웃이 새 가시 높이를 추종하고
   (`.min-h-dvh-safe`) CTA가 화면 밖으로 밀리거나 점프하지 않는다.
3. **safe-area**: 홈 인디케이터/노치 있는 기기에서 하단 CTA가 인디케이터에
   가리지 않는다(`.pb-safe-cta`). safe-area 없는 기기(SE·데스크톱)에서는 0으로
   no-op이라 과다 여백이 생기지 않는다.
   - 전제: `layout.tsx`의 `viewport.viewportFit = 'cover'`가 켜져 있어야
     `env(safe-area-inset-*)`가 실제 값을 반환한다(`conventions/mobile-foundations.md`).

### 데스크톱 회귀 확인(참고)
실기기 통과와 별개로, 데스크톱 브라우저(폭 ≥ `sm`)에서 기존 레이아웃이 변하지
않았는지 1회 회귀 확인한다(§3 체크리스트 D).

---

## 3. 스모크 테스트 체크리스트

각 Phase 완료 시 대상 화면에 대해 아래 항목을 §1 표준 폭 · §2 실기기에서 점검한다.
모든 항목이 통과해야 해당 Phase를 "Done"으로 판정한다.

### A. 레이아웃 무결성 (모든 화면 공통)
- [ ] **가로 스크롤 없음** — 375 / 390 / 430px 각 폭에서 좌우 이동 0 (§1).
- [ ] **최소 터치 타깃 44×44px** — 모든 버튼/링크/입력 컨트롤이 `.min-hit-target`
      또는 `.hit-target-expand`로 44×44px 이상(`touch/hit-target-min`, `mobile-foundations.md`).
- [ ] **하단 고정 CTA 가림/점프 없음** — 주소창 노출/숨김·홈 인디케이터에서 CTA가
      가리거나 튀지 않음(`.pb-safe-cta` + `.min-h-dvh-safe`, safe-area).
- [ ] **컨테이너 여백** — 콘텐츠가 화면 가장자리에 붙지 않음(표준 좌우 패딩
      `px-md`/서명자 `px-lg`, `responsive.md` §2).

### B. 서명자 해피패스 (Phase 1 — 최우선)
로딩 → 인증 → 열람 → 서명 → 완료를 단계별로 검사한다.

- [ ] **1) 로딩** (`components/signer/loading`) — 진입 시 전체 높이 레이아웃이
      `.min-h-dvh-safe`로 채워지고 가로 스크롤 없음.
- [ ] **2) 인증(OTP)** (`otp-input`, `verify`) — 숫자 키패드가 뜨고, 입력 시
      자동 포커스 이동, 붙여넣기 동작. 입력 칸이 44×44px 이상.
- [ ] **3) 열람 — 문서 뷰** (`document-viewer`) — 모바일 폭 페이지 핏, **핀치
      확대/축소** 동작, 엄지로 페이지 이동. 서명 패드와 `touch-action` 스코프가
      분리되어 핀치 줌과 그리기가 충돌하지 않음.
- [ ] **4) 서명 그리기** (`signature-pad`, `signature-sheet`) — 하단 바텀시트로
      올라오고, 소형 폭에서 패드 높이·여백 적절, 손가락으로 서명이 그려짐.
- [ ] **5) 완료·다운로드** (`completion-screen`, `completion-download`) — 완료
      화면 표시, 모바일 브라우저에서 PDF 다운로드/공유 동작.
- [ ] **하단 고정 CTA** — 위 각 단계의 주요 행동 버튼이 스크롤과 무관하게 항상
      도달 가능(safe-area 대응 하단 고정).

### C. 발송자 조회 (Phase 2)
- [ ] 대시보드 리스트/카드/플랜 사용량이 1열 모바일 레이아웃으로 정렬
      (`dashboard/page.tsx`), 가로 스크롤 없음.
- [ ] 헤더/내비게이션 모바일 축약(이메일 숨김 등), 로그인·회원가입 폼 모바일 정렬.
- [ ] 상태 뱃지·완료본 다운로드가 폰에서 동작(`status-badge`, `completion-download`).

### D. 데스크톱 회귀 (모든 Phase 공통)
- [ ] 폭 ≥ `sm` 데스크톱에서 기존 레이아웃·고정 폭(`max-w-[960/760/480/420/560px]`)·
      여백이 변하지 않음. 모바일 퍼스트 클래스 변경이 데스크톱 값을 되돌리지 않음
      (`responsive.md` §1 데스크톱 회귀 방지).

### E. Phase 3 — 생성 위저드 (선택적, 별도 결정)
> 기획서상 (a) 데스크톱 안내만 제공 vs (b) 완전 터치 지원 결정 후 적용. 미결정 시
> 기본값 (a)로 조회 전용. **(b) 채택 시에만** 아래를 검사한다.
- [ ] 위저드 하단 고정 바에 `.pb-safe-cta` 적용, 홈 인디케이터 가림 없음.
- [ ] 필드 배치가 터치로 동작(탭하여 추가 → 손가락 드래그로 이동).
- [ ] 스텝 인디케이터·상하단 고정 바가 소형 화면에 맞게 압축.

---

## 판정 규칙 (요약)
- **각 Phase Done = A(공통) + 해당 Phase 섹션(B/C/E) + D(회귀)** 를 §1 표준 폭과
  §2 실기기 양쪽에서 통과.
- 이 문서는 값을 재정의하지 않는다. 항목의 근거 값·유틸은 항상 `conventions/*`와
  `touch/hit-target-min`을 단일 출처로 참조한다.

---

## 부록 A — Phase 1 서명자 해피패스 검증 결과 (뷰포트 에뮬레이션)

> 실기기 실행은 이 개발 환경에서 불가하므로, 아래는 **dev/build 뷰포트 에뮬레이션**
> (375 / 390 / 430 + 보조 360px) 기준 검증 결과다. 브라우저 폭 시뮬레이션으로 **판정
> 불가**한 항목(주소창 dvh 리사이즈·safe-area 실측·실제 터치/공유)은 §2 실기기
> 매트릭스에서 **수동 후속**으로 남긴다. 코드로 실기기 "통과"를 단정하지 않는다.

### 판정 요약
- 서명자 해피패스(로딩→인증→열람→서명→완료→다운로드/공유)가 375~430px(+360)에서
  **가로 스크롤 없이 각 단계 완결**, 완료 화면 진입·다운로드/공유 트리거 동작.
  상태 전이(`signer-flow.tsx`: verify→viewing→signing→done)가 소형 화면에서 자연스럽게
  이어짐. → **PASS(에뮬레이션)**.

### 단계별 결과 (체크리스트 B)
| 단계 | 컴포넌트 | 결과 | 근거 |
|---|---|---|---|
| 1) 로딩 | `loading-screen` | PASS / **후속 있음** | 전체 높이·가로 스크롤 0. raw `min-h-[100dvh]`(폴백 라인 결여) → 소관 grain에서 `.min-h-dvh-safe` 정렬 권장(아래 후속). |
| 2) 인증(OTP) | `verify-screen`·`otp-input` | PASS | `.min-h-dvh-safe`, `sticky … pb-safe-cta` 하단 CTA, 셀 `h-14`≥44px·`min-w-0`, numeric 키패드·붙여넣기·포커스 이동. |
| 3) 열람(문서 뷰) | `document-viewer` | PASS | `.h-dvh-safe` 3-존, 하단 CTA `pb-safe-cta`, 줌/내비 버튼 44px, `touch-action` 스코프 분리. |
| 4) 서명 그리기 | `signature-sheet`·`signature-pad` | PASS | 바텀시트 `max-h-[calc(100dvh-2rem)] overflow-y-auto`, 모드 토글 44px. |
| 5) 완료·다운로드 | `completion-screen`·`completion-download` | **교정 후 PASS** | 완료 오버레이 스크롤 부재로 짧은/가로 뷰포트에서 하단 다운로드/공유 CTA가 잘리던 결함을 스크롤 세이프 센터링(`overflow-y-auto`+`m-auto`)으로 교정. 다운로드 행 `.min-hit-target`·모바일 세로 스택. |

### 공통(체크리스트 A)
- 가로 스크롤 0: 모든 서명자 컨테이너 `mx-auto w-full max-w-[480/420px]`+`px-lg`,
  플렉스 자식 `min-w-0`/`truncate` → 375·360px에서 넘침 없음. PASS.
- 44×44px 터치 타깃: OTP 셀·뷰어 줌/내비·완료 다운로드·주요 CTA 모두 충족. PASS.
- 하단 고정 CTA: `sticky/in-flow + pb-safe-cta + dvh-safe`로 에뮬레이션 기준 가림·
  점프 없음. (실기기 주소창 동적 리사이즈는 §2 수동 후속.)

### 이번 검증에서 교정한 이슈 (완료/다운로드 범위)
- **완료 오버레이 스크롤 세이프 센터링** — `components/signer/completion-screen.tsx`.
  전 서명자 완료(all-done) 경로에서 다운로드 카드까지 렌더 시 콘텐츠(~700px)가 짧은/
  가로 뷰포트를 초과, 기존 `justify-center`(스크롤 없음)가 하단 다운로드/공유 CTA를
  잘라 도달 불가였다. → 오버레이를 `overflow-y-auto` 스크롤 컨테이너로, 콘텐츠를
  `m-auto` 래퍼로 감싸 "여유 시 중앙, 넘치면 상·하단 스크롤 도달" 패턴으로 교정.
  신규 Token/CSS/유틸 없음(기존 Tailwind 유틸). 결정 기록:
  design-spec `conventions/completion-download.md` 결정 9.

### 타 단계 인계 이슈 (이번 grain 범위 밖 — 기록만)
- `components/signer/loading-screen.tsx`, `components/signer/notice-screen.tsx`가
  raw `min-h-[100dvh]`을 사용(표준 헬퍼 `.min-h-dvh-safe`의 `100vh` 폴백 라인 결여).
  dvh 값 자체는 정상이고 가로 스크롤·터치 문제는 없음. **각 화면 소관 grain에서
  `.min-h-dvh-safe`로 정렬 권장.** 상태: open.

## 부록 B — 실기기 스모크 수동 후속 (미실행)
이 환경에서 실행 불가. §2 매트릭스 각 기기(iOS Safari: SE 375 / iPhone 14·15 390 /
Pro Max 430, Android Chrome: Pixel 412 / Galaxy 360·384)에서 아래를 **수동 확인**한다.
- [ ] 주소창 노출/숨김(dvh) 양쪽에서 하단 고정 CTA 가림·점프 없음(verify·viewer).
- [ ] safe-area: 홈 인디케이터/노치 기기에서 `pb-safe-cta`·`pt-safe/pb-safe`
      클리어런스, SE(inset 0)에서 과다 여백 없음.
- [ ] 완료 오버레이 실제 오버플로 스크롤(짧은 기기·가로)에서 다운로드/공유 CTA 도달.
- [ ] `navigator.share` 시스템 공유 시트 실동작(iOS Safari·Android Chrome), 데스크톱
      다운로드 폴백 회귀 0.
- [ ] 핀치 줌 vs 서명 그리기 충돌 없음, 실제 터치 정확도(44px 타깃).
