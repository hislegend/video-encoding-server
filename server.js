const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// 프로젝트 상태 관리를 위한 메모리 저장소
const projects = new Map(); // projectId -> projectData
const projectFiles = new Map(); // projectId -> Map(fileName -> filePath)

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: false
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  if (req.url.includes('/api/')) {
    console.log(`\n🔍 === ${new Date().toISOString()} ===`);
    console.log(`📝 ${req.method} ${req.url}`);
  }
  next();
});

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB 제한
    files: 50 // 최대 50개 파일
  }
});

// ===== 대화형 서버 헬퍼 함수들 =====

// settings.json에서 필요한 파일 목록 추출
function extractRequiredFiles(settings) {
  const files = [];
  
  // 씬에서 사용하는 파일들
  if (settings.scenes) {
    settings.scenes.forEach(scene => {
      if (scene.image) files.push(scene.image);
      if (scene.tts) files.push(scene.tts);
      if (scene.sfx) files.push(scene.sfx);
    });
  }
  
  // 배경음악
  if (settings.bgm) {
    files.push(settings.bgm);
  }
  
  // 중복 제거
  return [...new Set(files)];
}

// 파일 검증 함수
async function validateFile(file, expectedFileName) {
  try {
    // 파일 크기 검증
    if (file.size === 0) {
      return { valid: false, error: '파일 크기가 0입니다' };
    }
    
    // 파일 확장자 검증
    const ext = path.extname(expectedFileName).toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.m4a', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov'];
    
    if (!allowedExts.includes(ext)) {
      return { valid: false, error: `지원하지 않는 파일 형식: ${ext}` };
    }
    
    // 이미지 파일 검증
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      if (!file.mimetype.startsWith('image/')) {
        return { valid: false, error: '이미지 파일의 MIME 타입이 올바르지 않습니다' };
      }
    }
    
    // 오디오 파일 검증
    if (['.mp3', '.wav', '.m4a'].includes(ext)) {
      if (!file.mimetype.startsWith('audio/')) {
        return { valid: false, error: '오디오 파일의 MIME 타입이 올바르지 않습니다' };
      }
    }
    
    return { valid: true };
    
  } catch (error) {
    return { valid: false, error: `파일 검증 중 오류: ${error.message}` };
  }
}

// 안전한 텍스트 이스케이핑 함수 (FFmpeg drawtext 필터용)
function escapeFFmpegText(text) {
  if (!text) return '';
  
  return text
    .replace(/\\/g, '\\\\')    // 백슬래시 이스케이핑
    .replace(/'/g, "\\'")      // 작은따옴표 이스케이핑  
    .replace(/"/g, '\\"')      // 큰따옴표 이스케이핑
    .replace(/:/g, '\\:')      // 콜론 이스케이핑
    .replace(/\[/g, '\\[')     // 대괄호 이스케이핑
    .replace(/,/g, '\\,')      // 쉼표 이스케이핑
    .replace(/;/g, '\\;');     // 세미콜론 이스케이핑
}

// 사용 가능한 폰트 찾기 함수
function findAvailableFont() {
  const fontPaths = [
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Arial.ttf', 
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/NotoSansCJK-Regular.ttc'
  ];
  
  for (const fontPath of fontPaths) {
    if (fs.existsSync(fontPath)) {
      console.log(`✅ 폰트 발견: ${fontPath}`);
      return fontPath;
    }
  }
  
  console.log('⚠️  시스템 폰트로 폴백');
  return 'Arial'; // 폴백
}

// FFmpeg 영상 조립 함수
async function assembleVideo(project, fileMapping) {
  const { settings } = project;
  const outputFileName = `output_${project.id}_${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, outputFileName);
  
  await fs.ensureDir(outputDir);
  
  console.log('🎬 FFmpeg 영상 조립 시작');
  console.log('📁 사용할 파일들:');
  for (const [fileName, filePath] of fileMapping) {
    console.log(`  ${fileName} -> ${filePath}`);
  }
  
  return new Promise((resolve, reject) => {
    const ffmpegCommand = ffmpeg();
    
    // 이미지 입력 추가
    settings.scenes.forEach((scene, index) => {
      if (scene.image) {
        const imagePath = fileMapping.get(scene.image);
        ffmpegCommand.input(imagePath);
        console.log(`🖼️  이미지 입력 ${index}: ${scene.image} -> ${imagePath}`);
      }
    });
    
    // 오디오 입력 추가
    const audioInputs = [];
    let audioIndex = settings.scenes.length;
    
    settings.scenes.forEach((scene, index) => {
      if (scene.tts) {
        const ttsPath = fileMapping.get(scene.tts);
        ffmpegCommand.input(ttsPath);
        audioInputs.push({ type: 'tts', index: audioIndex++, scene: index });
        console.log(`🎤 TTS 입력: ${scene.tts} -> ${ttsPath}`);
      }
    });
    
    if (settings.bgm) {
      const bgmPath = fileMapping.get(settings.bgm);
      ffmpegCommand.input(bgmPath);
      audioInputs.push({ type: 'bgm', index: audioIndex++ });
      console.log(`🎵 BGM 입력: ${settings.bgm} -> ${bgmPath}`);
    }
    
    // 비디오 필터 생성
    let videoFilter = '';
    settings.scenes.forEach((scene, index) => {
      const duration = scene.duration || 3;
      videoFilter += `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS,fps=30,loop=loop=-1:size=1:start=0[v${index}];`;
    });
    
    // 비디오 연결
    const videoInputs = settings.scenes.map((_, index) => `[v${index}]`).join('');
    videoFilter += `${videoInputs}concat=n=${settings.scenes.length}:v=1:a=0[video];`;
    
    // 자막 추가 (안전한 텍스트 처리)
    let currentVideoStream = '[video]';
    settings.scenes.forEach((scene, index) => {
      if (scene.subtitle && scene.subtitle.text) {
        const startTime = settings.scenes.slice(0, index).reduce((sum, s) => sum + (s.duration || 3), 0);
        const endTime = startTime + (scene.duration || 3);
        
        const safeText = escapeFFmpegText(scene.subtitle.text);
        const fontFile = findAvailableFont();
        const fontSize = scene.subtitle.fontSize || 24;
        
        const drawTextFilter = `drawtext=fontfile='${fontFile}':text='${safeText}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=h-text_h-50:enable='between(t,${startTime},${endTime})'`;
        
        const outputStream = `[video_sub${index}]`;
        videoFilter += `${currentVideoStream}${drawTextFilter}${outputStream};`;
        currentVideoStream = outputStream;
      }
    });
    
    // 오디오 믹싱
    let audioFilter = '';
    if (audioInputs.length > 0) {
      const ttsInputs = audioInputs.filter(a => a.type === 'tts');
      const bgmInputs = audioInputs.filter(a => a.type === 'bgm');
      
      if (ttsInputs.length > 0 && bgmInputs.length > 0) {
        const ttsStreams = ttsInputs.map(a => `[${a.index}:a]`).join('');
        audioFilter += `${ttsStreams}concat=n=${ttsInputs.length}:v=0:a=1[tts_combined];`;
        audioFilter += `[tts_combined][${bgmInputs[0].index}:a]amix=inputs=2:duration=shortest:dropout_transition=2[audio]`;
      } else if (ttsInputs.length > 0) {
        const ttsStreams = ttsInputs.map(a => `[${a.index}:a]`).join('');
        audioFilter += `${ttsStreams}concat=n=${ttsInputs.length}:v=0:a=1[audio]`;
      } else if (bgmInputs.length > 0) {
        audioFilter += `[${bgmInputs[0].index}:a]acopy[audio]`;
      }
    }
    
    // 최종 필터 조합
    let finalFilter = videoFilter;
    if (audioFilter) {
      finalFilter += audioFilter;
    }
    
    console.log('🔧 생성된 FFmpeg 필터:');
    console.log(finalFilter);
    
    // FFmpeg 실행
    ffmpegCommand
      .complexFilter(finalFilter)
      .outputOptions([
        '-map', currentVideoStream.replace('[', '').replace(']', ''),
        ...(audioFilter ? ['-map', '[audio]'] : []),
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('🚀 FFmpeg 명령어 실행:');
        console.log(commandLine);
      })
      .on('stderr', (stderrLine) => {
        console.log('📋 FFmpeg:', stderrLine);
      })
      .on('end', () => {
        console.log('✅ FFmpeg 처리 완료!');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg 오류:', err.message);
        reject(err);
      })
      .run();
  });
}

// ===== 대화형 서버 API 엔드포인트들 =====

// 1단계: 프로젝트 생성 (settings.json만 받음)
app.post('/api/create-project', async (req, res) => {
  try {
    console.log('\n🚀 === 프로젝트 생성 요청 ===');
    
    const { settings } = req.body;
    if (!settings) {
      return res.status(400).json({ error: 'settings.json 데이터가 필요합니다' });
    }
    
    const projectId = uuidv4();
    const projectDir = path.join(uploadDir, projectId);
    await fs.ensureDir(projectDir);
    
    // settings.json 파일 저장
    await fs.writeJson(path.join(projectDir, 'settings.json'), settings, { spaces: 2 });
    
    // 필요한 파일 목록 생성
    const requiredFiles = extractRequiredFiles(settings);
    
    const projectData = {
      id: projectId,
      settings,
      requiredFiles,
      uploadedFiles: new Map(),
      status: 'created',
      createdAt: new Date().toISOString(),
      projectDir
    };
    
    projects.set(projectId, projectData);
    projectFiles.set(projectId, new Map());
    
    console.log(`✅ 프로젝트 생성 완료: ${projectId}`);
    console.log(`📋 필요한 파일 수: ${requiredFiles.length}`);
    console.log('📝 필요한 파일들:', requiredFiles);
    
    res.json({
      success: true,
      projectId,
      requiredFiles,
      message: `프로젝트가 생성되었습니다. ${requiredFiles.length}개의 파일이 필요합니다.`
    });
    
  } catch (error) {
    console.error('❌ 프로젝트 생성 오류:', error);
    res.status(500).json({ error: '프로젝트 생성 중 오류가 발생했습니다', details: error.message });
  }
});

// 2단계: 파일 개별 업로드
app.post('/api/upload-file/:projectId', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { fileName } = req.body;
    
    console.log(`\n📤 === 파일 업로드: ${projectId} ===`);
    console.log(`📁 파일명: ${fileName}`);
    
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다' });
    }
    
    // 파일 검증
    const validation = await validateFile(req.file, fileName);
    if (!validation.valid) {
      await fs.remove(req.file.path); // 잘못된 파일 삭제
      return res.status(400).json({ error: validation.error });
    }
    
    // 프로젝트 디렉토리로 파일 이동
    const targetPath = path.join(project.projectDir, fileName);
    await fs.move(req.file.path, targetPath);
    
    // 파일 매핑 업데이트
    const fileMap = projectFiles.get(projectId);
    fileMap.set(fileName, targetPath);
    project.uploadedFiles.set(fileName, {
      path: targetPath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    });
    
    const progress = {
      uploaded: project.uploadedFiles.size,
      total: project.requiredFiles.length,
      percentage: Math.round((project.uploadedFiles.size / project.requiredFiles.length) * 100)
    };
    
    console.log(`✅ 파일 업로드 완료: ${fileName}`);
    console.log(`📊 진행률: ${progress.uploaded}/${progress.total} (${progress.percentage}%)`);
    
    res.json({
      success: true,
      fileName,
      progress,
      message: `${fileName} 업로드 완료`
    });
    
  } catch (error) {
    console.error('❌ 파일 업로드 오류:', error);
    res.status(500).json({ error: '파일 업로드 중 오류가 발생했습니다', details: error.message });
  }
});

// 3단계: 프로젝트 상태 확인
app.get('/api/project-status/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다' });
    }
    
    const progress = {
      uploaded: project.uploadedFiles.size,
      total: project.requiredFiles.length,
      percentage: Math.round((project.uploadedFiles.size / project.requiredFiles.length) * 100)
    };
    
    const missingFiles = project.requiredFiles.filter(fileName => 
      !project.uploadedFiles.has(fileName)
    );
    
    const canAssemble = missingFiles.length === 0;
    
    res.json({
      projectId,
      status: project.status,
      progress,
      missingFiles,
      canAssemble,
      uploadedFiles: Array.from(project.uploadedFiles.keys())
    });
    
  } catch (error) {
    console.error('❌ 상태 확인 오류:', error);
    res.status(500).json({ error: '상태 확인 중 오류가 발생했습니다', details: error.message });
  }
});

// 4단계: 최종 조립 실행
app.post('/api/assemble-video/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    console.log(`\n🎬 === 영상 조립 시작: ${projectId} ===`);
    
    if (!project) {
      return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다' });
    }
    
    // 모든 파일이 업로드되었는지 확인
    const missingFiles = project.requiredFiles.filter(fileName => 
      !project.uploadedFiles.has(fileName)
    );
    
    if (missingFiles.length > 0) {
      return res.status(400).json({ 
        error: '아직 업로드되지 않은 파일이 있습니다',
        missingFiles 
      });
    }
    
    project.status = 'assembling';
    
    // FFmpeg 조립 실행
    const outputPath = await assembleVideo(project, projectFiles.get(projectId));
    
    project.status = 'completed';
    project.outputPath = outputPath;
    project.completedAt = new Date().toISOString();
    
    console.log('✅ 영상 조립 완료!');
    
    res.json({
      success: true,
      projectId,
      outputPath: `/output/${path.basename(outputPath)}`,
      message: '영상 조립이 완료되었습니다'
    });
    
  } catch (error) {
    console.error('❌ 영상 조립 오류:', error);
    const project = projects.get(req.params.projectId);
    if (project) project.status = 'error';
    
    res.status(500).json({ 
      error: '영상 조립 중 오류가 발생했습니다', 
      details: error.message 
    });
  }
});

// ===== 기타 API =====

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 출력 파일 제공
app.use('/output', express.static(outputDir));

// 상태 확인
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: '대화형 영상 인코딩 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    activeProjects: projects.size,
    endpoints: {
      createProject: 'POST /api/create-project',
      uploadFile: 'POST /api/upload-file/:projectId',
      projectStatus: 'GET /api/project-status/:projectId',
      assembleVideo: 'POST /api/assemble-video/:projectId'
    }
  });
});

// 서버 시작
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 대화형 영상 인코딩 서버가 다음 주소에서 실행 중입니다:`);
  console.log(`   - 로컬: http://localhost:${PORT}`);
  console.log(`   - 네트워크: http://0.0.0.0:${PORT}`);
  console.log('📁 업로드 폴더:', uploadDir);
  console.log('📁 출력 폴더:', outputDir);
  console.log('\n🔄 === 대화형 API 사용법 ===');
  console.log('1. POST /api/create-project (settings.json 전송)');
  console.log('2. POST /api/upload-file/:projectId (파일 개별 업로드)');
  console.log('3. GET /api/project-status/:projectId (진행률 확인)');
  console.log('4. POST /api/assemble-video/:projectId (최종 조립)');
});

module.exports = app;
