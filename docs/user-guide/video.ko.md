# 영상 제작과 YouTube 게시

Mimi Seed는 글로 쓴 story를 로컬 영상 프로젝트(스토리보드 · 자산 · 타임라인 · 렌더된 MP4)로 만들고,
결과물을 내 YouTube 채널에 게시할 수 있다. 게시 직전까지는 전부 **내 컴퓨터 안에서** 일어난다. 렌더는
FFmpeg가 하고, 프로젝트 폴더가 단일 출처다.

이후 내용의 대부분은 두 경계에서 나온다.

- **레퍼런스는 소재가 아니다.** YouTube 리서치는 구조·훅·템포 파악용 공개 메타데이터만 모은다. 결과는
  영구히 reference-only로 기록되며 다운로드하거나 렌더에 넣지 않는다.
- **게시는 되돌릴 수 없다.** 업로드 기본값은 private이고, public/unlisted는 같은 턴의 명시적 승인이 있어야 한다.

## 사전 조건

| 기능 | 필요한 것 |
|---|---|
| 스토리보드, 리서치 종합 | `ANTHROPIC_API_KEY` ([레퍼런스](../credentials.ko.md#anthropic-api-key)) |
| YouTube 레퍼런스 리서치 | `YOUTUBE_API_KEY` |
| 라이선스 스톡 검색·다운로드 | `PEXELS_API_KEY` |
| 장면 이미지 생성 | `OPENAI_API_KEY` (유료 — 반드시 미리보기 먼저) |
| 렌더와 검증 | FFmpeg + ffprobe가 `PATH`에 있거나 `MIMI_SEED_FFMPEG_PATH` / `MIMI_SEED_FFPROBE_PATH` 지정 |
| YouTube 업로드·상태·공개 변경 | **`youtube` 스코프**가 포함된 Google 로그인 |

키는 각각 선택이다. 실제로 실행할 단계에 필요한 것만 있으면 된다. YouTube 스코프는 기존 권한을 건드리지
않고 추가할 수 있다.

```bash
npx mimi-seed auth login --domains youtube
```

재인증은 증분 방식이라 기존 Firebase/Play/AdMob 권한은 그대로 유지된다.

## 1. 영상 기획

```text
이 story를 ./marketing/launch-video 아래 세로 30초 영상 프로젝트로 만들어줘.
대상은 기존 사용자, 핵심 메시지 하나는 오프라인 모드. 장면 계획부터 보여줘.
```

`video_plan_from_story`가 `project.json`과 자산·리서치·렌더 폴더를 만든다. 기존 `project.json`은
`overwrite=true` 없이 덮어쓰지 않으므로 다시 실행해도 안전하다.

먼저 정해야 하는 것 — 말하지 않으면 에이전트가 물어야 한다: 대상, 핵심 메시지 하나, 첫 1초의 훅, CTA,
화면비, 최대 길이.

## 2. 리서치 (선택, reference-only)

```text
비슷한 앱 기능 소개 Shorts가 어떤 구조인지 조사하고, 제작 방향 브리프로 종합해줘.
```

- `video_research_youtube` → `research/youtube.json`, 모든 항목이 reference-only로 표시된다.
- `video_search_stock_assets` → `research/pexels.json` (검색만. 다운로드는 별도 승인 단계다).
- `video_synthesize_research` → `research/brief.json`. 저장된 메타데이터에 **사용자가 직접 보고 적은 메모**를
  합쳐 방향을 정리한다.

종합 도구는 제목·설명과 사용자 메모만 읽는다. 프레임이나 오디오를 본 것이 아니고 봤다고 주장해서도 안 된다.
따라서 결과는 "검증된 성공 공식"이 아니라 시도해볼 추상 패턴과 복제하면 안 되는 요소의 가설로 다룬다.

## 3. 자산 확보 — 렌더 가능 여부는 출처가 결정한다

| 출처 | 도구 | 규칙 |
|---|---|---|
| 라이선스 스톡 | `video_download_stock_assets` | 먼저 미리보기, 그다음 `confirm=true`. Pexels 공식 호스트만, 파일당 100MB, 호출당 5개 |
| 생성 이미지 | `video_generate_image` | `confirm=false`는 계획만 반환. 비용이 발생하므로 명시 승인 후 실행. 응답에는 이미지 바이트 없이 로컬 절대경로만 온다 |
| 내가 가진 소재 | `video_add_local_asset` | 절대경로 + 라이선스/소유 근거를 `assets.json`에 기록 |

`assets.json`에 `allowedForRendering=true`로 기록되고 reference-only가 아닌 자산만 타임라인에 들어갈 수 있다.
레퍼런스 영상이 공개로 보인다고 해서 재사용 권리가 생기는 것은 아니다.

> 이미지는 **글자 없이** 생성하고 자막은 렌더 단계에서 번인한다. 생성 이미지 안에 그려진 글자는 수정할 수
> 없고, 특히 한글은 안정적으로 렌더되지 않는다.

## 4. 타임라인 구성

```text
승인된 자산으로 타임라인 만들어줘. 장면 순서, 장면별 길이, 각 장면의 화면 문구까지.
```

`video_build_timeline`이 `timeline.json`을 만든다. 화면 문구는 렌더에서 자막으로 번인되므로, 문구 검수는
렌더 후가 아니라 이 단계에서 한다.

슬라이드쇼가 아니라 영상을 만든다: 모션을 섞고(피사체 기준 팬, 텍스트 등장, 오브젝트 애니메이션, 매치 컷,
UI 캡처), 모든 장면에 같은 중앙 줌을 쓰지 않으며, 전환은 짧게, 장면 길이는 내레이션이 정한다. 같은 스틸을
연속 장면에 재사용하지 않는다.

## 5. 렌더

`video_render`는 먼저 계획을 반환하고, `confirm=true`로 호출하면 로컬 FFmpeg 작업을 시작하고 즉시 `jobId`를
돌려준다. 진행 상황과 결과 절대경로는 `video_job_status`로 확인한다. 실패한 작업은 로그 마지막 부분을 함께 준다.

MCP 클라이언트 타임아웃을 넘긴 렌더는 **실패가 아니다.** 새로 돌리기 전에 작업 상태부터 확인한다.

## 6. 공개 전 검증

```text
완성 파일 검증하고, 컨택트 시트 만들어줘 — 첫 프레임, 장면 전환 지점 전부, 자막이 가장 빽빽한 구간, CTA.
```

`video_validate`가 최종 절대경로에 ffprobe를 돌려 H.264/yuv420p가 아닌 경우와 길이·해상도·오디오 문제를 표시한다.

코덱 통과는 품질 통과가 아니다. 사람이 나오는 프레임은 원본 해상도로 전부 확인하고, 머리 잘린 몸·잘린 얼굴·
불안한 헤드룸·읽히지 않는 글자·플랫폼 UI에 가려질 자막은 반려한다. 그다음 소리를 켜고 전체를 본다.

## 7. YouTube 게시

```text
완성본을 private으로 업로드해줘. 공개로 바꾸지 마.
```

- `youtube_upload_video`의 기본값은 **private**이다. `public` / `unlisted`는 `confirmVisible=true`와 같은 턴의
  명시 승인이 함께 있어야 한다.
- Shorts로 낼 때는 `shortsOnly=true`를 쓰고, 사실적인 합성 미디어는 정확히 고지한다.
- `youtube_get_video_status`로 처리 완료를 확인한 뒤 공개 상태가 요청대로인지 검증한다. 나중에 바꿀 때는
  `youtube_update_video_privacy`를 쓰며 확인 규칙은 동일하다.

**업로드 호출이 타임아웃되면 결과는 알 수 없는 상태다.** 파일을 직접 스트리밍하므로 클라이언트가 기다리기를
멈춘 뒤 YouTube가 완료할 수 있다. YouTube Studio에서 같은 제목의 최근 영상을 먼저 확인하고, `videoId`를
받았다면 `youtube_get_video_status`로 대조한다. 자동 재시도는 하지 않는다 — 중복 업로드는 그렇게 생긴다.

## 운영 체크리스트

- 스토리보드 전에 핵심 메시지·훅·화면비·길이 합의
- 모든 자산에 라이선스 또는 소유 근거 기록
- 타임라인에 reference-only 자료 없음
- 자막은 렌더 후가 아니라 `timeline.json`에서 검수
- 사람이 나오는 프레임은 원본 해상도로 확인
- `video_validate` 통과 + 소리 켜고 전체 시청
- 먼저 private으로 업로드, 공개 전환은 명시 요청이 있을 때만
- 처리 완료 후 최종 공개 상태 확인

## 문제 해결

| 증상 | 대응 |
|---|---|
| 렌더 작업이 `video_job_status`에 안 보임 | FFmpeg/ffprobe가 `PATH`에 있는지 확인하거나 `MIMI_SEED_FFMPEG_PATH` / `MIMI_SEED_FFPROBE_PATH` 지정 |
| 렌더가 즉시 실패 | 반환된 로그 마지막 부분을 읽는다. 대부분 자산 경로 누락이나 지원하지 않는 원본 파일이다 |
| 타임라인이 자산을 거부 | `assets.json` 항목에 출처가 없거나 reference-only다. 라이선스 근거와 함께 `video_add_local_asset`으로 다시 등록 |
| 스톡 다운로드가 거부됨 | Pexels 공식 미디어 호스트만 허용되며 파일당 100MB, 호출당 5개 제한 |
| 업로드에서 인증 오류 | `npx mimi-seed auth login --domains youtube` 실행 후, Studio를 확인하고 나서 재시도 |
| 업로드 타임아웃 | 채널을 먼저 확인하고 `youtube_get_video_status`로 대조한 뒤에만 재시도 |

## 관련 문서

- [소셜 게시](social.ko.md) — Facebook · Instagram · Threads 출시 공지
- [스토어 운영](stores.ko.md) — 영상이 따라붙는 스토어 릴리스 작업
- [계정 연결 레퍼런스](../credentials.ko.md) — 각 API 키를 어디서 발급받는지
- [에이전트 가이드](../agent-guide.md) — 에이전트가 따라야 하는 정확한 호출 순서
