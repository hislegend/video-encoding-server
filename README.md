# 영상 인코딩 서버 🎬

영상 파일을 업로드하고 최적화된 형태로 인코딩하는 웹 서버입니다.

## 주요 기능

- 📁 **영상 파일 업로드**: 드래그 앤 드롭 또는 파일 선택으로 간편 업로드
- 🔄 **자동 인코딩**: FFmpeg를 사용한 고품질 영상 인코딩 (H.264, AAC)
- 📱 **반응형 웹 인터페이스**: 모던하고 직관적인 UI/UX
- 📊 **실시간 진행률**: 업로드 및 인코딩 진행 상황 실시간 표시
- 📂 **파일 관리**: 인코딩된 파일 목록 및 다운로드 기능
- 🎥 **Google Studio 연동 준비**: API 연동을 위한 기본 구조 포함

## 기술 스택

- **Backend**: Node.js, Express.js
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **영상 처리**: FFmpeg, fluent-ffmpeg
- **파일 업로드**: Multer
- **기타**: CORS, fs-extra

## 설치 및 실행

### 1. 환경 설정

```bash
# Node.js 설치 (Mac)
brew install node

# FFmpeg 설치 (Mac)
brew install ffmpeg
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 서버 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

서버가 실행되면 http://localhost:3000 에서 접속할 수 있습니다.

## 프로젝트 구조

```
video-encoding-server/
├── server.js              # 메인 서버 파일
├── package.json           # 프로젝트 설정 및 의존성
├── README.md             # 프로젝트 문서
├── public/               # 정적 파일
│   └── index.html        # 웹 인터페이스
├── uploads/              # 업로드된 원본 파일 (임시)
└── output/               # 인코딩된 결과 파일
```

## API 엔드포인트

- `GET /` - 메인 웹 인터페이스
- `POST /upload` - 영상 파일 업로드 및 인코딩
- `GET /download/:filename` - 인코딩된 파일 다운로드
- `GET /files` - 인코딩된 파일 목록 조회

## 인코딩 설정

현재 기본 인코딩 설정:
- **해상도**: 1280x720 (HD)
- **비디오 코덱**: H.264 (libx264)
- **오디오 코덱**: AAC
- **비디오 비트레이트**: 1000k
- **오디오 비트레이트**: 128k

## 향후 개발 계획

- [ ] Google Studio API 연동 완성
- [ ] 다양한 해상도 옵션 제공
- [ ] 배치 처리 기능
- [ ] 사용자 인증 시스템
- [ ] 클라우드 스토리지 연동

## 라이센스

MIT License

## 작성자

hislegend
