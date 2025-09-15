# 대화형 영상 인코딩 서버 API 가이드

## 🔄 새로운 대화형 아키텍처

기존의 "한 번에 모든 파일을 업로드하고 처리" 방식에서 **4단계 대화형 방식**으로 변경되었습니다.

### 🎯 주요 장점
- **안정성 극대화**: 각 단계별로 오류를 즉시 감지하고 처리
- **진행률 추적**: 실시간으로 업로드 진행률 확인 가능
- **파일 검증**: 업로드 즉시 파일 유효성 검사
- **확장성**: 수백 개의 파일도 안정적으로 처리

## 📡 API 엔드포인트

### 서버 URL
- **로컬**: `http://localhost:3000`
- **배포**: `https://web-production-cf4bf.up.railway.app`

## 🚀 4단계 사용법

### 1단계: 프로젝트 생성
```javascript
// POST /api/create-project
const response = await fetch('/api/create-project', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    settings: {
      duration: 15,
      global: {
        resolution: "1920x1080"
      },
      scenes: [
        {
          image: "scene-0-image.png",
          tts: "scene-0-tts.wav",
          duration: 5,
          subtitle: {
            text: "안녕하세요",
            fontSize: 24
          }
        }
      ],
      bgm: "background-music.mp3"
    }
  })
});

const { projectId, requiredFiles } = await response.json();
console.log('프로젝트 ID:', projectId);
console.log('필요한 파일들:', requiredFiles);
```

### 2단계: 파일 개별 업로드
```javascript
// POST /api/upload-file/:projectId
for (const fileName of requiredFiles) {
  const formData = new FormData();
  formData.append('file', fileBlob); // 실제 파일 데이터
  formData.append('fileName', fileName);
  
  const response = await fetch(`/api/upload-file/${projectId}`, {
    method: 'POST',
    body: formData
  });
  
  const result = await response.json();
  console.log(`${fileName} 업로드:`, result.progress);
}
```

### 3단계: 상태 확인
```javascript
// GET /api/project-status/:projectId
const response = await fetch(`/api/project-status/${projectId}`);
const status = await response.json();

console.log('진행률:', status.progress);
console.log('누락된 파일:', status.missingFiles);
console.log('조립 가능 여부:', status.canAssemble);
```

### 4단계: 최종 조립
```javascript
// POST /api/assemble-video/:projectId
const response = await fetch(`/api/assemble-video/${projectId}`, {
  method: 'POST'
});

const result = await response.json();
console.log('완성된 영상:', result.outputPath);
```

## 📋 완전한 예제 코드

```javascript
class ConversationalVideoProcessor {
  constructor(serverUrl = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
  }
  
  async processVideo(settings, files) {
    try {
      // 1단계: 프로젝트 생성
      console.log('🚀 프로젝트 생성 중...');
      const projectResponse = await fetch(`${this.serverUrl}/api/create-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      
      const { projectId, requiredFiles } = await projectResponse.json();
      console.log(`✅ 프로젝트 생성 완료: ${projectId}`);
      
      // 2단계: 파일 업로드
      console.log('📤 파일 업로드 시작...');
      for (const fileName of requiredFiles) {
        const file = files[fileName];
        if (!file) {
          throw new Error(`파일을 찾을 수 없습니다: ${fileName}`);
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('fileName', fileName);
        
        const uploadResponse = await fetch(`${this.serverUrl}/api/upload-file/${projectId}`, {
          method: 'POST',
          body: formData
        });
        
        const uploadResult = await uploadResponse.json();
        console.log(`📁 ${fileName}: ${uploadResult.progress.percentage}%`);
      }
      
      // 3단계: 상태 확인
      const statusResponse = await fetch(`${this.serverUrl}/api/project-status/${projectId}`);
      const status = await statusResponse.json();
      
      if (!status.canAssemble) {
        throw new Error(`누락된 파일: ${status.missingFiles.join(', ')}`);
      }
      
      // 4단계: 영상 조립
      console.log('🎬 영상 조립 시작...');
      const assembleResponse = await fetch(`${this.serverUrl}/api/assemble-video/${projectId}`, {
        method: 'POST'
      });
      
      const result = await assembleResponse.json();
      console.log('✅ 영상 조립 완료!');
      
      return {
        success: true,
        projectId,
        outputPath: result.outputPath,
        downloadUrl: `${this.serverUrl}${result.outputPath}`
      };
      
    } catch (error) {
      console.error('❌ 처리 중 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// 사용 예제
const processor = new ConversationalVideoProcessor();
const settings = { /* settings.json 내용 */ };
const files = {
  'scene-0-image.png': imageFile,
  'scene-0-tts.wav': audioFile,
  'background-music.mp3': bgmFile
};

processor.processVideo(settings, files)
  .then(result => {
    if (result.success) {
      console.log('다운로드 URL:', result.downloadUrl);
    } else {
      console.error('실패:', result.error);
    }
  });
```

## 🔧 오류 처리

### 일반적인 오류 상황
1. **프로젝트를 찾을 수 없음** (404)
   - 잘못된 projectId 사용
   
2. **파일 검증 실패** (400)
   - 지원하지 않는 파일 형식
   - 파일 크기가 0인 경우
   - MIME 타입 불일치

3. **누락된 파일** (400)
   - 필요한 파일이 모두 업로드되지 않음

4. **FFmpeg 처리 오류** (500)
   - 파일 손상 또는 호환성 문제

### 오류 응답 예제
```json
{
  "error": "파일이 업로드되지 않았습니다",
  "details": "multipart/form-data가 필요합니다"
}
```

## 📊 진행률 추적

실시간으로 업로드 진행률을 추적할 수 있습니다:

```javascript
async function trackProgress(projectId) {
  const response = await fetch(`/api/project-status/${projectId}`);
  const status = await response.json();
  
  return {
    percentage: status.progress.percentage,
    uploaded: status.progress.uploaded,
    total: status.progress.total,
    missingFiles: status.missingFiles,
    canAssemble: status.canAssemble
  };
}
```

## 🎯 마이그레이션 가이드

### 기존 단일 요청 방식에서 변경점

**이전 (단일 요청)**:
```javascript
// 모든 파일을 한 번에 전송
const formData = new FormData();
formData.append('settings.json', settingsFile);
formData.append('scene-0-image.png', imageFile);
formData.append('scene-0-tts.wav', audioFile);

fetch('/api/process-video', { method: 'POST', body: formData });
```

**현재 (대화형)**:
```javascript
// 1. 프로젝트 생성
const { projectId } = await createProject(settings);

// 2. 파일 개별 업로드
await uploadFile(projectId, 'scene-0-image.png', imageFile);
await uploadFile(projectId, 'scene-0-tts.wav', audioFile);

// 3. 최종 조립
await assembleVideo(projectId);
```

## 🚨 중요 사항

1. **프로젝트 ID 보관**: 각 단계에서 동일한 projectId 사용 필수
2. **파일명 정확성**: settings.json에 명시된 파일명과 정확히 일치해야 함
3. **순서 준수**: 반드시 1→2→3→4 단계 순서로 진행
4. **오류 처리**: 각 단계에서 오류 발생 시 즉시 처리

이 새로운 아키텍처로 훨씬 안정적이고 확장 가능한 영상 처리가 가능합니다!
