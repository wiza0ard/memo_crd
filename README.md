# [Flash-Card Memo System]

> ⚠️ **중요: 이 프로젝트는 'No License' 정책을 따릅니다.**

---

## 📜 저작권 및 사용 조건

Copyright © 2026 **wiza0ard**. All rights reserved.

이 저장소의 모든 소스 코드, 문서, 이미지 및 기타 자료들은 저작권법의 보호를 받습니다.

**누구든지 다음 행위를 금지합니다:**

- 본 코드의 전체 또는 일부를 복사, 수정, 병합, 게시, 배포하는 행위
- 본 코드를 기반으로 한 파생 작업을 생성하는 행위
- 본 코드를 상업적 목적을 포함한 어떠한 목적으로든 사용하는 행위

본 코드는 **오직 열람(Read-Only) 목적으로만 공개**되어 있습니다.  
GitHub의 '포크(fork)' 기능을 통해 복제본을 만드는 것은 허용되나, 이는 GitHub 이용약관에 따른 플랫폼 기능적 허용일 뿐이며,  
복제된 코드에 대한 **사용, 수정, 배포 권한을 부여하는 것이 절대 아닙니다.**

---

## 📧 문의

본 프로젝트의 코드 사용에 대한 별도 허가가 필요하신 경우, 아래로 연락해 주세요:

- **GitHub**: [@wiza0ard](https://github.com/wiza0ard)
- **이메일**: []

---

## ⚖️ 법적 고지

본 프로젝트는 '소스 공개(Source Available)' 방식으로 운영되며, 오픈 소스 라이선스(Open Source License)가 적용되지 않습니다.  
무단 사용 시 저작권법에 따라 민·형사상 법적 조치가 취해질 수 있음을 알려드립니다.

---

*Last updated: June 30, 2026*


# memo_crd

범용 기억 보강용 플래시카드 웹앱. 영어 결합어구, 수학 문제, 문학 발췌 등
서로 다른 형태의 자료를 deck별로 다른 입력 필드 구성으로 다룰 수 있습니다.

## 구조

```
memo_crd/
├── index.html         학습 화면 (deck 선택 → 좌/우 클릭으로 면 넘기기)
├── control.html        카드 추가 / 검색 / 수정 / 삭제
├── gh-api.js            GitHub Contents API 공용 모듈 (토큰 인증, 읽기/쓰기, raw 업로드)
├── style.css
├── field_schemas.json   deck별 입력 필드 / 면 구성 정의
├── cards.json            핵심 DB (카드 본문) — 예제 8장 포함
├── scores.json           학습 기록 (★/❌), cards.json의 id를 참조
└── raw/
    ├── images/
    ├── audio/
    └── pdf/
```

## 카드 모델

- 카드는 `deck`에 속하고, `stages`(면) 배열을 가집니다. 면 수는 deck/카드마다 다를 수 있습니다.
- 화면에서 카드 중앙선 기준 **오른쪽 클릭/탭 = 다음 면, 왼쪽 = 이전 면**, 매번 같은 방향으로 플립이 누적되며
  마지막 면 다음엔 다시 1면으로 순환합니다.
- `links` 배열로 다른 카드(예: 같은 패턴의 수학 문제)를 직접 연결해 학습 중 바로 이동할 수 있습니다.
- 영어단어 deck: 1면(결합어구+발음+예문) / 2면(예문 속 단어별 주석: 레벨/영문 뜻풀이/한글 힌트).
  `difficulty`는 L0~Lx 5단계, 기본값만 채워지고 추후 직접 재조정합니다.
- 수학 deck: 4면 템플릿(문제/해독·전략/풀이/정답·패턴)에서 시작하되 "+ 면 추가"로 자유롭게 확장 가능
  (예: 변형 패턴, 소거법 같은 보충 면).
- 모든 필드는 선택(optional)입니다. 무엇을 채우고 무엇을 생략할지는 전적으로 작성자의 판단에 맡깁니다.

## 사용 순서

1. GitHub에 `memo_crd` 레포 생성 (Public/Private 무관) 후 이 폴더 전체를 업로드합니다.
2. Settings → Pages → `Deploy from a branch` → `main` / `(root)` 로 GitHub Pages 활성화.
3. Fine-grained Personal Access Token 발급 (`memo_crd` 저장소만 선택, Contents: Read and write).
4. 배포된 주소(`https://<사용자명>.github.io/memo_crd/`)로 접속 → 토큰/사용자명 입력 → 바로 사용.
5. 카드 추가/수정/삭제는 `control.html`(우측 상단 ⚙️)에서, 학습은 `index.html`에서.

## 설계 메모

- cards.json은 control.html을 통한 단일 입력 창구만 가정하므로, 저장 시 최신본을 한 번 더 받아온 뒤
  덮어쓰는 최소한의 충돌 방지만 적용했습니다(복잡한 merge-on-write 로직은 적용하지 않음).
- deck/필드 구성을 바꾸고 싶으면 `field_schemas.json`만 수정하면 됩니다 — control.html이 이를 읽어
  입력 폼을 동적으로 그립니다.
