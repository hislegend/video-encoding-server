const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');
const GoogleStudioAPI = require('./google-studio');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: false
}));

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`\n=== ${new Date().toISOString()} ===`);
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Multer 설정 (다중 파일 업로드)
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
  fileFilter: (req, file, cb) => {
    console.log('파일 필터 체크:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    
    // 모든 파일 형식 허용
    cb(null, true);
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB 제한
    files: 50 // 최대 50개 파일
  }
});

// 라우트: 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 라우트: settings.json 기반 영상 조립 API
app.post('/api/process-video', upload.any(), async (req, res) => {
  console.log('\n🎬 === settings.json 기반 영상 조립 요청 수신 ===');
  console.log('📊 요청 정보:');
  console.log('  - 업로드된 파일 수:', req.files ? req.files.length : 0);
  console.log('  - Body 데이터 키:', Object.keys(req.body || {}));
  console.log('  - Content-Type:', req.headers['content-type']);
  console.log('  - Content-Length:', req.headers['content-length']);
  
  console.log('\n📁 업로드된 파일 상세:');
  if (req.files && req.files.length > 0) {
    req.files.forEach((file, index) => {
      console.log(`  ${index + 1}. 필드명: "${file.fieldname}"`);
      console.log(`     원본명: "${file.originalname}"`);
      console.log(`     MIME타입: ${file.mimetype}`);
      console.log(`     크기: ${file.size} bytes`);
      console.log(`     저장경로: ${file.path}`);
    });
  } else {
    console.log('  ❌ 업로드된 파일이 없습니다.');
  }
  
  console.log('\n📝 Body 데이터 상세:');
  if (req.body && Object.keys(req.body).length > 0) {
    Object.keys(req.body).forEach(key => {
      const value = req.body[key];
      console.log(`  ${key}: ${typeof value} (길이: ${value?.length || 'N/A'})`);
    });
  } else {
    console.log('  ❌ Body 데이터가 없습니다.');
  }

  try {
    // === 1단계: 파일 수신 및 매핑 테이블 생성 ===
    console.log('\n🗂️ === 1단계: 파일 매핑 테이블 생성 ===');
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: '업로드된 파일이 없습니다.',
        details: 'multipart/form-data로 파일들을 업로드해주세요.'
      });
    }

    // 파일명(키) → 실제 저장 경로(값) 매핑 테이블 생성
    const fileMapping = new Map();
    let settingsFilePath = null;

    req.files.forEach((file, index) => {
      console.log(`  📄 파일 ${index + 1}:`);
      console.log(`     필드명: "${file.fieldname}"`);
      console.log(`     원본명: "${file.originalname}"`);
      console.log(`     실제경로: "${file.path}"`);
      console.log(`     크기: ${file.size} bytes`);
      
      // 매핑 테이블에 등록 (필드명과 원본명 모두로 접근 가능하도록)
      fileMapping.set(file.fieldname, file.path);
      fileMapping.set(file.originalname, file.path);
      
      // settings.json 파일 식별
      if (file.fieldname === 'settings.json' || 
          file.fieldname === 'settings' || 
          file.originalname === 'settings.json') {
        settingsFilePath = file.path;
        console.log(`     ⭐ settings.json으로 식별됨`);
      }
    });

    console.log('\n📋 생성된 파일 매핑 테이블:');
    for (const [key, path] of fileMapping) {
      console.log(`  "${key}" → "${path}"`);
    }

    if (!settingsFilePath) {
      console.log('\n❌ settings.json 파일을 찾을 수 없습니다.');
      return res.status(400).json({
        success: false,
        error: 'settings.json 파일이 필요합니다.',
        details: 'settings.json 파일을 필드명 "settings.json", "settings" 또는 파일명 "settings.json"으로 업로드해주세요.',
        receivedFiles: req.files.map(f => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype
        })),
        expectedFieldNames: ['settings.json', 'settings']
      });
    }

    // === 2단계: settings.json 읽기 및 파싱 ===
    console.log('\n📖 === 2단계: settings.json 파싱 ===');
    const settingsContent = await fs.readFile(settingsFilePath, 'utf8');
    let settings;
    
    try {
      settings = JSON.parse(settingsContent);
      console.log('✅ settings.json 파싱 완료');
      console.log('📊 영상 설정 요약:');
      console.log(`  - 지속시간: ${settings.duration || 'N/A'}초`);
      console.log(`  - 해상도: ${settings.global?.resolution || 'N/A'}`);
      console.log(`  - 씬 개수: ${settings.scenes?.length || 0}개`);
      console.log(`  - 자막 개수: ${settings.subtitles?.length || 0}개`);
    } catch (parseError) {
      throw new Error(`settings.json 파싱 오류: ${parseError.message}`);
    }

    // === 3단계: 필요한 파일들 존재 여부 검증 ===
    console.log('\n🔍 === 3단계: 필요한 파일들 존재 여부 검증 ===');
    const missingFiles = [];
    
    // 씬에서 사용하는 이미지 파일들 검증
    if (settings.scenes) {
      settings.scenes.forEach((scene, index) => {
        if (scene.image) {
          const imagePath = fileMapping.get(scene.image);
          if (imagePath) {
            console.log(`  ✅ 씬 ${index} 이미지: "${scene.image}" → "${imagePath}"`);
          } else {
            console.log(`  ❌ 씬 ${index} 이미지 누락: "${scene.image}"`);
            missingFiles.push(scene.image);
          }
        }
      });
    }

    // 배경음악 파일 검증
    if (settings.global?.backgroundMusic) {
      const bgmPath = fileMapping.get(settings.global.backgroundMusic);
      if (bgmPath) {
        console.log(`  ✅ 배경음악: "${settings.global.backgroundMusic}" → "${bgmPath}"`);
      } else {
        console.log(`  ❌ 배경음악 누락: "${settings.global.backgroundMusic}"`);
        missingFiles.push(settings.global.backgroundMusic);
      }
    }

    // TTS 오디오 파일들 검증
    if (settings.subtitles) {
      settings.subtitles.forEach((subtitle, index) => {
        if (subtitle.audioFile) {
          const audioPath = fileMapping.get(subtitle.audioFile);
          if (audioPath) {
            console.log(`  ✅ TTS ${index}: "${subtitle.audioFile}" → "${audioPath}"`);
          } else {
            console.log(`  ❌ TTS ${index} 누락: "${subtitle.audioFile}"`);
            missingFiles.push(subtitle.audioFile);
          }
        }
      });
    }

    if (missingFiles.length > 0) {
      throw new Error(`필요한 파일들이 누락되었습니다: ${missingFiles.join(', ')}`);
    }

    console.log('✅ 모든 필요한 파일들이 확인되었습니다.');

    // 출력 파일 경로
    const outputFileName = `assembled-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    // 글로벌 설정 적용
    const globalSettings = settings.global || {};
    const resolution = globalSettings.resolution || '1280x720';
    const duration = settings.duration || 10;

    // === 4단계: 매핑 테이블 기반 FFmpeg 영상 조립 ===
    console.log('\n🎬 === 4단계: FFmpeg 영상 조립 시작 ===');

    if (!settings.scenes || settings.scenes.length === 0) {
      throw new Error('settings.json에 scenes 배열이 필요합니다.');
    }

    // 첫 번째 씬의 이미지를 베이스로 사용
    const firstScene = settings.scenes[0];
    const firstImagePath = fileMapping.get(firstScene.image);
    
    console.log(`🖼️ 베이스 이미지: "${firstScene.image}" → "${firstImagePath}"`);

    // FFmpeg 명령어 구성
    let ffmpegCommand = ffmpeg();

    // 이미지 기반 영상 생성
    ffmpegCommand = ffmpegCommand
      .input(firstImagePath)
      .inputOptions(['-loop', '1', '-t', duration.toString()])
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(resolution)
      .format('mp4')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart'
      ]);

    console.log(`📐 영상 설정: ${resolution}, ${duration}초`);

    // 배경음악 추가
    if (globalSettings.backgroundMusic) {
      const bgmPath = fileMapping.get(globalSettings.backgroundMusic);
      if (bgmPath) {
        ffmpegCommand = ffmpegCommand.input(bgmPath);
        console.log(`🎵 배경음악 추가: "${globalSettings.backgroundMusic}" → "${bgmPath}"`);
      }
    }

    // TTS 오디오 파일들 수집
    const audioInputs = [];
    let audioIndex = globalSettings.backgroundMusic ? 2 : 1; // 0: 이미지, 1: 배경음악(있으면), 그 다음: TTS

    if (settings.subtitles) {
      settings.subtitles.forEach((subtitle, index) => {
        if (subtitle.audioFile) {
          const audioPath = fileMapping.get(subtitle.audioFile);
          if (audioPath) {
            ffmpegCommand = ffmpegCommand.input(audioPath);
            audioInputs.push({
              index: audioIndex,
              startTime: subtitle.startTime || 0,
              duration: subtitle.duration || 2,
              fileName: subtitle.audioFile
            });
            audioIndex++;
            console.log(`🗣️ TTS ${index} 추가: "${subtitle.audioFile}" → "${audioPath}" (${subtitle.startTime}s)`);
          }
        }
      });
    }

    // 오디오 믹싱 설정
    if (audioInputs.length > 0) {
      console.log('\n🎵 === 오디오 믹싱 설정 ===');
      let filterComplex = [];
      
      // 배경음악 볼륨 조절
      if (globalSettings.backgroundMusic) {
        const bgVolume = globalSettings.backgroundMusicVolume || 0.3;
        filterComplex.push(`[1:a]volume=${bgVolume}[bg]`);
        console.log(`🎼 배경음악 볼륨: ${bgVolume}`);
      }

      // TTS 오디오들 처리
      audioInputs.forEach((audio, idx) => {
        const volume = globalSettings.voiceVolume || 1.0;
        filterComplex.push(`[${audio.index}:a]volume=${volume}[tts${idx}]`);
        console.log(`🗣️ TTS ${idx} (${audio.fileName}) 볼륨: ${volume}`);
      });

      // 최종 믹싱
      const mixInputs = [];
      if (globalSettings.backgroundMusic) mixInputs.push('[bg]');
      audioInputs.forEach((_, idx) => mixInputs.push(`[tts${idx}]`));

      if (mixInputs.length > 1) {
        filterComplex.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`);
        ffmpegCommand = ffmpegCommand
          .complexFilter(filterComplex)
          .outputOptions(['-map', '0:v', '-map', '[aout]']);
        console.log(`🎛️ 오디오 믹싱: ${mixInputs.length}개 트랙`);
      }
    }

    // 텍스트 이스케이핑 함수
    const escapeFFmpegText = (text) => {
      if (!text) return '';
      return text
        .replace(/\\/g, '\\\\')    // 백슬래시
        .replace(/'/g, "\\'")      // 작은따옴표
        .replace(/"/g, '\\"')      // 큰따옴표
        .replace(/:/g, '\\:')      // 콜론
        .replace(/\[/g, '\\[')     // 대괄호
        .replace(/\]/g, '\\]')     // 대괄호
        .replace(/,/g, '\\,')      // 쉼표
        .replace(/;/g, '\\;');     // 세미콜론
    };

    // 자막 추가 (drawtext 필터) - 안전한 방식
    let finalVideoStream = '[0:v]';
    
    if (settings.subtitles && settings.subtitles.length > 0) {
      console.log('\n📝 === 자막 추가 ===');
      
      // 폰트 확인 함수
      const checkFontExists = async (fontPath) => {
        try {
          await fs.access(fontPath);
          return true;
        } catch {
          return false;
        }
      };
      
      // 사용 가능한 폰트 찾기
      const fontPaths = [
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/TTF/NotoSansCJK-Regular.ttc',
        '/System/Library/Fonts/Arial.ttf'
      ];
      
      let availableFont = null;
      for (const fontPath of fontPaths) {
        if (await checkFontExists(fontPath)) {
          availableFont = fontPath;
          console.log(`✅ 사용할 폰트: ${fontPath}`);
          break;
        }
      }
      
      if (!availableFont) {
        console.log('⚠️ 시스템 폰트를 사용합니다 (폰트 파일을 찾을 수 없음)');
      }

      // 모든 자막을 하나의 복합 필터로 처리
      const drawTextFilters = [];
      
      settings.subtitles.forEach((subtitle, index) => {
        const safeText = escapeFFmpegText(subtitle.text || `자막 ${index + 1}`);
        const fontSize = Math.max(12, Math.min(72, subtitle.fontSize || 24)); // 안전한 범위
        const fontColor = subtitle.fontColor || 'white';
        const x = subtitle.x || '(w-text_w)/2';
        const y = subtitle.y || 'h-th-50';
        const startTime = Math.max(0, subtitle.startTime || 0);
        const duration = Math.max(1, subtitle.duration || 3);
        
        console.log(`  자막 ${index + 1}: "${safeText}"`);
        console.log(`    시간: ${startTime}s~${startTime + duration}s`);
        console.log(`    크기: ${fontSize}px, 색상: ${fontColor}`);
        
        // 안전한 drawtext 필터 생성
        let drawtextOptions = [
          `text='${safeText}'`,
          `fontsize=${fontSize}`,
          `fontcolor=${fontColor}`,
          `x=${x}`,
          `y=${y}`,
          `enable='between(t,${startTime},${startTime + duration})'`
        ];
        
        if (availableFont) {
          drawtextOptions.unshift(`fontfile='${availableFont}'`);
        }
        
        const inputStream = index === 0 ? '[0:v]' : `[v${index - 1}]`;
        const outputStream = `[v${index}]`;
        
        drawTextFilters.push(`${inputStream}drawtext=${drawtextOptions.join(':')}${outputStream}`);
      });
      
      if (drawTextFilters.length > 0) {
        // 모든 자막 필터를 순차적으로 적용
        ffmpegCommand = ffmpegCommand.complexFilter(drawTextFilters);
        finalVideoStream = `[v${settings.subtitles.length - 1}]`;
        console.log(`📝 ${settings.subtitles.length}개 자막 필터 적용 완료`);
      }
    }

    // 최종 출력 매핑 설정
    if (finalVideoStream !== '[0:v]') {
      ffmpegCommand = ffmpegCommand.outputOptions(['-map', finalVideoStream.replace(/[\[\]]/g, '')]);
    }

    // FFmpeg 실행
    console.log('\n⚙️ === FFmpeg 실행 ===');
    console.log(`📺 최종 비디오 스트림: ${finalVideoStream}`);
    
    await new Promise((resolve, reject) => {
      ffmpegCommand
        .on('start', (cmd) => {
          console.log('🚀 FFmpeg 명령어 시작');
          console.log('📋 전체 명령어:');
          console.log(cmd);
          console.log('================================================================================');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`📊 조립 진행률: ${Math.round(progress.percent)}%`);
          }
        })
        .on('stderr', (stderrLine) => {
          console.log('🔍 FFmpeg stderr:', stderrLine);
        })
        .on('end', () => {
          console.log('✅ 영상 조립 완료');
          resolve();
        })
        .on('error', (err) => {
          console.error('\n💥 === FFmpeg 오류 상세 분석 ===');
          console.error('📝 오류 메시지:', err.message);
          console.error('🔍 오류 코드:', err.code || 'N/A');
          
          if (err.stderr) {
            console.error('\n📋 FFmpeg stderr 전체 출력:');
            console.error('================================================================================');
            console.error(err.stderr);
            console.error('================================================================================');
            
            // 일반적인 오류 패턴 분석
            const stderr = err.stderr.toLowerCase();
            if (stderr.includes('font') || stderr.includes('fontconfig')) {
              console.error('🚨 폰트 관련 오류 감지됨');
            }
            if (stderr.includes('invalid argument') || stderr.includes('syntax error')) {
              console.error('🚨 명령어 문법 오류 감지됨');
            }
            if (stderr.includes('no such file')) {
              console.error('🚨 파일 경로 오류 감지됨');
            }
          }
          
          console.error('\n🔧 디버깅 정보:');
          console.error('- 입력 파일들이 모두 존재하는지 확인');
          console.error('- 폰트 파일이 서버에 설치되어 있는지 확인');
          console.error('- 자막 텍스트에 특수문자가 포함되어 있는지 확인');
          
          reject(err);
        })
        .run();
    });

    // 원본 파일들 정리
    console.log('\n🧹 === 임시 파일 정리 ===');
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.remove(file.path);
          console.log(`  ✅ 삭제: ${file.originalname}`);
        } catch (cleanupError) {
          console.log(`  ⚠️ 삭제 실패: ${file.originalname} - ${cleanupError.message}`);
        }
      }
    }

    // 결과 파일 읽기
    console.log('\n📤 === 결과 파일 처리 ===');
    const assembledBuffer = await fs.readFile(outputPath);
    const assembledBase64 = assembledBuffer.toString('base64');
    console.log(`📊 최종 영상 크기: ${assembledBuffer.length} bytes`);

    res.json({
      success: true,
      message: '영상 조립이 완료되었습니다.',
      outputFile: outputFileName,
      downloadUrl: `/download/${outputFileName}`,
      videoData: `data:video/mp4;base64,${assembledBase64}`,
      fileSize: assembledBuffer.length,
      processedSettings: {
        duration: settings.duration,
        resolution: globalSettings.resolution,
        scenes: settings.scenes?.length || 0,
        subtitles: settings.subtitles?.length || 0,
        totalFiles: req.files?.length || 0,
        mappedFiles: fileMapping.size
      }
    });

  } catch (error) {
    console.error('\n💥 === 영상 조립 오류 발생 ===');
    console.error('오류 타입:', error.constructor.name);
    console.error('오류 메시지:', error.message);
    console.error('오류 스택:', error.stack);
    
    // 파일 정리
    if (req.files) {
      console.log('🧹 업로드된 파일들 정리 중...');
      for (const file of req.files) {
        try {
          await fs.remove(file.path);
          console.log(`  ✅ 삭제 완료: ${file.path}`);
        } catch (cleanupError) {
          console.error(`  ❌ 삭제 실패: ${file.path}`, cleanupError.message);
        }
      }
    }
    
    res.status(500).json({
      success: false,
      error: '영상 조립 중 오류가 발생했습니다.',
      details: error.message,
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
  }
});

// 라우트: 다운로드
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(outputDir, filename);
  
  if (fs.existsSync(filepath)) {
    res.download(filepath);
  } else {
    res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }
});

// 라우트: 상태 확인 API
app.get('/api/status', (req, res) => {
  console.log('📊 상태 확인 요청 수신');
  res.json({
    success: true,
    message: '영상 인코딩 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    server: {
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    },
    endpoints: {
      processVideo: '/api/process-video (POST)',
      testUpload: '/api/test-upload (POST)',
      download: '/download/:filename (GET)',
      status: '/api/status (GET)'
    },
    features: {
      settingsBasedAssembly: 'settings.json 기반 영상 조립',
      multiFileUpload: '다중 파일 업로드 지원 (최대 50개, 각 500MB)',
      audioMixing: '배경음악 + TTS 오디오 믹싱',
      imageToVideo: '이미지를 영상으로 변환',
      corsEnabled: 'CORS 모든 도메인 허용',
      debugLogging: '상세 디버깅 로그 활성화'
    },
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
    }
  });
});

// 라우트: 업로드 테스트 API
app.post('/api/test-upload', upload.any(), (req, res) => {
  console.log('\n🧪 === 업로드 테스트 요청 수신 ===');
  console.log('업로드된 파일 수:', req.files ? req.files.length : 0);
  console.log('Body 키:', Object.keys(req.body || {}));
  
  res.json({
    success: true,
    message: '업로드 테스트 성공',
    receivedFiles: req.files?.map(f => ({
      fieldname: f.fieldname,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size
    })) || [],
    receivedBody: req.body || {},
    headers: {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      origin: req.headers.origin
    },
    timestamp: new Date().toISOString()
  });
  
  // 테스트 파일들 정리
  if (req.files) {
    req.files.forEach(async (file) => {
      try {
        await fs.remove(file.path);
      } catch (err) {
        console.error('테스트 파일 정리 오류:', err);
      }
    });
  }
});

// 폰트 환경 확인
const checkFonts = async () => {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);
  
  console.log('\n🔍 === 서버 환경 폰트 확인 ===');
  
  try {
    // fc-list 명령어로 설치된 폰트 확인
    const { stdout } = await execAsync('fc-list | grep -i noto || echo "Noto 폰트 없음"');
    console.log('📝 설치된 Noto 폰트들:');
    console.log(stdout || '없음');
  } catch (error) {
    console.log('⚠️ 폰트 확인 실패:', error.message);
  }
  
  try {
    // FFmpeg 버전 확인
    const { stdout: ffmpegVersion } = await execAsync('ffmpeg -version | head -1');
    console.log('🎬 FFmpeg 버전:', ffmpegVersion.trim());
  } catch (error) {
    console.log('⚠️ FFmpeg 확인 실패:', error.message);
  }
};

// 서버 시작
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 영상 인코딩 서버가 다음 주소에서 실행 중입니다:`);
  console.log(`   - 로컬: http://localhost:${PORT}`);
  console.log(`   - 네트워크: http://0.0.0.0:${PORT}`);
  console.log('📁 업로드 폴더:', uploadDir);
  console.log('📁 출력 폴더:', outputDir);
  console.log('🌐 외부 서비스에서 접근 가능합니다.');
  
  // 환경 확인
  await checkFonts();
});

module.exports = app;
