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
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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
  console.log('=== settings.json 기반 영상 조립 요청 수신 ===');
  console.log('업로드된 파일 수:', req.files ? req.files.length : 0);
  console.log('Body 데이터:', Object.keys(req.body || {}));
  
  if (req.files) {
    req.files.forEach(file => {
      console.log(`파일: ${file.fieldname} - ${file.originalname} (${file.mimetype})`);
    });
  }

  try {
    // settings.json 파일 찾기
    const settingsFile = req.files?.find(file => 
      file.fieldname === 'settings.json' || 
      file.originalname === 'settings.json' ||
      file.fieldname === 'settings'
    );

    if (!settingsFile) {
      return res.status(400).json({
        success: false,
        error: 'settings.json 파일이 필요합니다.',
        receivedFiles: req.files?.map(f => f.fieldname) || []
      });
    }

    // settings.json 파싱
    const settingsContent = await fs.readFile(settingsFile.path, 'utf8');
    let settings;
    try {
      settings = JSON.parse(settingsContent);
      console.log('✅ settings.json 파싱 완료');
      console.log('영상 설정:', {
        duration: settings.duration,
        resolution: settings.global?.resolution,
        scenes: settings.scenes?.length || 0,
        subtitles: settings.subtitles?.length || 0
      });
    } catch (parseError) {
      throw new Error(`settings.json 파싱 오류: ${parseError.message}`);
    }

    // 미디어 파일들을 파일명으로 매핑
    const mediaFiles = {};
    if (req.files) {
      req.files.forEach(file => {
        if (file !== settingsFile) {
          mediaFiles[file.originalname] = file.path;
        }
      });
    }

    console.log('미디어 파일 매핑:', Object.keys(mediaFiles));

    // 출력 파일 경로
    const outputFileName = `assembled-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    // 글로벌 설정 적용
    const globalSettings = settings.global || {};
    const resolution = globalSettings.resolution || '1280x720';
    const duration = settings.duration || 10;

    console.log('FFmpeg 영상 조립 시작...');

    // 씬 기반 영상 조립
    if (settings.scenes && settings.scenes.length > 0) {
      // 첫 번째 씬의 이미지를 베이스로 사용
      const firstScene = settings.scenes[0];
      const firstImageFile = mediaFiles[firstScene.image];
      
      if (!firstImageFile) {
        throw new Error(`첫 번째 씬의 이미지 파일을 찾을 수 없습니다: ${firstScene.image}`);
      }

      // FFmpeg 명령어 구성
      let ffmpegCommand = ffmpeg();

      // 이미지 기반 영상 생성
      ffmpegCommand = ffmpegCommand
        .input(firstImageFile)
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

      // 배경음악 추가
      if (globalSettings.backgroundMusic && mediaFiles[globalSettings.backgroundMusic]) {
        ffmpegCommand = ffmpegCommand.input(mediaFiles[globalSettings.backgroundMusic]);
        console.log('배경음악 추가:', globalSettings.backgroundMusic);
      }

      // TTS 오디오 파일들 수집
      const audioInputs = [];
      let audioIndex = 2; // 0: 이미지, 1: 배경음악, 2부터: TTS

      if (settings.subtitles) {
        settings.subtitles.forEach((subtitle, index) => {
          if (subtitle.audioFile && mediaFiles[subtitle.audioFile]) {
            ffmpegCommand = ffmpegCommand.input(mediaFiles[subtitle.audioFile]);
            audioInputs.push({
              index: audioIndex,
              startTime: subtitle.startTime || 0,
              duration: subtitle.duration || 2
            });
            audioIndex++;
            console.log(`TTS 오디오 추가: ${subtitle.audioFile} (${subtitle.startTime}s)`);
          }
        });
      }

      // 오디오 믹싱 설정
      if (audioInputs.length > 0) {
        let filterComplex = [];
        
        // 배경음악 볼륨 조절
        if (globalSettings.backgroundMusic && mediaFiles[globalSettings.backgroundMusic]) {
          const bgVolume = globalSettings.backgroundMusicVolume || 0.3;
          filterComplex.push(`[1:a]volume=${bgVolume}[bg]`);
        }

        // TTS 오디오들 처리
        audioInputs.forEach((audio, idx) => {
          const volume = globalSettings.voiceVolume || 1.0;
          filterComplex.push(`[${audio.index}:a]volume=${volume}[tts${idx}]`);
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
        }
      }

      // FFmpeg 실행
      await new Promise((resolve, reject) => {
        ffmpegCommand
          .on('start', (cmd) => {
            console.log('FFmpeg 명령어:', cmd);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log('조립 진행률:', Math.round(progress.percent) + '%');
            }
          })
          .on('end', () => {
            console.log('✅ 영상 조립 완료');
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ FFmpeg 조립 오류:', err);
            reject(err);
          })
          .run();
      });

    } else {
      throw new Error('settings.json에 scenes 배열이 필요합니다.');
    }

    // 원본 파일들 정리
    if (req.files) {
      for (const file of req.files) {
        await fs.remove(file.path);
      }
    }

    // 결과 파일 읽기
    const assembledBuffer = await fs.readFile(outputPath);
    const assembledBase64 = assembledBuffer.toString('base64');

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
        mediaFiles: Object.keys(mediaFiles).length
      }
    });

  } catch (error) {
    console.error('❌ 영상 조립 오류:', error);
    
    // 파일 정리
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.remove(file.path);
        } catch (cleanupError) {
          console.error('파일 정리 오류:', cleanupError);
        }
      }
    }
    
    res.status(500).json({
      success: false,
      error: '영상 조립 중 오류가 발생했습니다.',
      details: error.message
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
  res.json({
    success: true,
    message: '영상 인코딩 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    endpoints: {
      processVideo: '/api/process-video',
      download: '/download/:filename',
      status: '/api/status'
    },
    features: {
      settingsBasedAssembly: 'settings.json 기반 영상 조립',
      multiFileUpload: '다중 파일 업로드 지원',
      audioMixing: '배경음악 + TTS 오디오 믹싱',
      imageToVideo: '이미지를 영상으로 변환'
    }
  });
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 영상 인코딩 서버가 다음 주소에서 실행 중입니다:`);
  console.log(`   - 로컬: http://localhost:${PORT}`);
  console.log(`   - 네트워크: http://0.0.0.0:${PORT}`);
  console.log('📁 업로드 폴더:', uploadDir);
  console.log('📁 출력 폴더:', outputDir);
  console.log('🌐 외부 서비스에서 접근 가능합니다.');
});

module.exports = app;
