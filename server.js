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
  origin: '*', // 모든 도메인에서 접근 허용 (개발용)
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' })); // 대용량 데이터 처리
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Multer 설정 (파일 업로드)
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
    // 비디오 파일만 허용
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('비디오 파일만 업로드 가능합니다.'), false);
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB 제한
  }
});

// 라우트: 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 라우트: 파일 업로드 및 인코딩
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const inputPath = req.file.path;
    const outputFileName = `encoded-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    console.log('인코딩 시작:', req.file.originalname);

    // FFmpeg를 사용한 비디오 인코딩
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('1280x720') // HD 해상도
      .videoBitrate('1000k')
      .audioBitrate('128k')
      .on('start', (commandLine) => {
        console.log('FFmpeg 명령어:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('진행률:', Math.round(progress.percent) + '%');
      })
      .on('end', () => {
        console.log('인코딩 완료:', outputFileName);
        // 원본 파일 삭제
        fs.remove(inputPath);
        
        res.json({
          success: true,
          message: '인코딩이 완료되었습니다.',
          outputFile: outputFileName,
          downloadUrl: `/download/${outputFileName}`
        });
      })
      .on('error', (err) => {
        console.error('인코딩 오류:', err);
        fs.remove(inputPath); // 오류 시에도 원본 파일 삭제
        res.status(500).json({ 
          error: '인코딩 중 오류가 발생했습니다.',
          details: err.message 
        });
      })
      .run();

  } catch (error) {
    console.error('업로드 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 라우트: 인코딩된 파일 다운로드
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(outputDir, filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, (err) => {
      if (err) {
        console.error('다운로드 오류:', err);
        res.status(500).json({ error: '다운로드 중 오류가 발생했습니다.' });
      }
    });
  } else {
    res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }
});

// 라우트: 업로드된 파일 목록
app.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(outputDir).map(filename => ({
      name: filename,
      downloadUrl: `/download/${filename}`,
      size: fs.statSync(path.join(outputDir, filename)).size
    }));
    
    res.json({ files });
  } catch (error) {
    console.error('파일 목록 조회 오류:', error);
    res.status(500).json({ error: '파일 목록을 가져올 수 없습니다.' });
  }
});

// 라우트: 외부 서비스용 영상 처리 API
app.post('/api/process-video', upload.single('video'), async (req, res) => {
  try {
    console.log('API 요청 수신:', {
      hasFile: !!req.file,
      hasBody: !!req.body,
      bodyKeys: Object.keys(req.body || {}),
      contentType: req.headers['content-type']
    });

    // FormData로 전송된 파일 처리
    if (req.file) {
      console.log('파일 업로드 방식으로 처리:', req.file.originalname);
      
      const inputPath = req.file.path;
      const outputFileName = `processed-${Date.now()}.mp4`;
      const outputPath = path.join(outputDir, outputFileName);

      // 설정값 파싱 (FormData에서 문자열로 전송됨)
      let settings = {};
      if (req.body.settings) {
        try {
          settings = JSON.parse(req.body.settings);
        } catch (e) {
          console.log('설정값 파싱 실패, 기본값 사용');
        }
      }

      // FFmpeg 인코딩
      const ffmpegCommand = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size(settings?.resolution || '1280x720')
        .videoBitrate(settings?.videoBitrate || '1000k')
        .audioBitrate(settings?.audioBitrate || '128k');

      await new Promise((resolve, reject) => {
        ffmpegCommand
          .on('start', (commandLine) => {
            console.log('FFmpeg 명령어:', commandLine);
          })
          .on('progress', (progress) => {
            console.log('진행률:', Math.round(progress.percent) + '%');
          })
          .on('end', () => {
            console.log('외부 서비스 영상 처리 완료:', outputFileName);
            resolve();
          })
          .on('error', (err) => {
            console.error('인코딩 오류:', err);
            reject(err);
          })
          .run();
      });

      // 원본 파일 삭제
      await fs.remove(inputPath);

      // 처리된 파일을 base64로 변환
      const processedBuffer = await fs.readFile(outputPath);
      const processedBase64 = processedBuffer.toString('base64');

      res.json({
        success: true,
        message: '영상 처리가 완료되었습니다.',
        outputFile: outputFileName,
        downloadUrl: `/download/${outputFileName}`,
        processedData: `data:video/mp4;base64,${processedBase64}`,
        fileSize: processedBuffer.length
      });
      return;
    }

    // JSON 방식 (기존 코드 유지)
    const { videoData, filename, settings } = req.body;
    
    if (!videoData) {
      return res.status(400).json({ 
        success: false,
        error: '영상 데이터가 필요합니다.' 
      });
    }

    // Base64 데이터를 파일로 저장
    const inputFileName = filename || `input-${Date.now()}.mp4`;
    const inputPath = path.join(uploadDir, inputFileName);
    
    // Base64 디코딩 및 파일 저장
    let buffer;
    if (videoData.startsWith('data:')) {
      // data:video/mp4;base64,... 형태
      const base64Data = videoData.split(',')[1];
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      // 순수 base64 데이터
      buffer = Buffer.from(videoData, 'base64');
    }
    
    await fs.writeFile(inputPath, buffer);
    
    const outputFileName = `processed-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    console.log('외부 서비스 영상 처리 시작:', inputFileName);

    // FFmpeg를 사용한 비디오 인코딩
    const ffmpegCommand = ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(settings?.resolution || '1280x720')
      .videoBitrate(settings?.videoBitrate || '1000k')
      .audioBitrate(settings?.audioBitrate || '128k');

    // 프로미스로 FFmpeg 실행
    await new Promise((resolve, reject) => {
      ffmpegCommand
        .on('start', (commandLine) => {
          console.log('FFmpeg 명령어:', commandLine);
        })
        .on('progress', (progress) => {
          console.log('진행률:', Math.round(progress.percent) + '%');
        })
        .on('end', () => {
          console.log('외부 서비스 영상 처리 완료:', outputFileName);
          resolve();
        })
        .on('error', (err) => {
          console.error('인코딩 오류:', err);
          reject(err);
        })
        .run();
    });

    // 원본 파일 삭제
    await fs.remove(inputPath);
    
    // 처리된 파일을 Base64로 인코딩하여 응답
    const processedBuffer = await fs.readFile(outputPath);
    const processedBase64 = processedBuffer.toString('base64');
    
    res.json({
      success: true,
      message: '영상 처리가 완료되었습니다.',
      outputFile: outputFileName,
      downloadUrl: `/download/${outputFileName}`,
      processedData: `data:video/mp4;base64,${processedBase64}`,
      fileSize: processedBuffer.length
    });

  } catch (error) {
    console.error('외부 서비스 영상 처리 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '영상 처리 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 라우트: 간단한 상태 확인 API
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: '영상 인코딩 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    endpoints: {
      upload: '/upload',
      processVideo: '/api/process-video',
      download: '/download/:filename',
      files: '/files',
      youtubeUpload: '/upload-youtube'
    }
  });
});

// 라우트: YouTube 업로드
app.post('/upload-youtube', async (req, res) => {
  try {
    const { filename, apiKey, title, description, privacy } = req.body;
    
    if (!filename || !apiKey) {
      return res.status(400).json({ 
        error: '파일명과 API 키가 필요합니다.' 
      });
    }

    const filePath = path.join(outputDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        error: '업로드할 파일을 찾을 수 없습니다.' 
      });
    }

    const googleStudio = new GoogleStudioAPI(apiKey);
    
    // API 키 유효성 검사
    const isValidKey = await googleStudio.validateApiKey();
    if (!isValidKey) {
      return res.status(401).json({ 
        error: '유효하지 않은 Google API 키입니다.' 
      });
    }

    const metadata = {
      title: title || `인코딩된 비디오 - ${filename}`,
      description: description || 'Video Encoding Server로 인코딩된 비디오입니다.',
      privacy: privacy || 'private'
    };

    console.log('YouTube 업로드 시작:', filename);
    const result = await googleStudio.uploadVideo(filePath, metadata);
    
    if (result.success) {
      console.log('YouTube 업로드 완료:', result.url);
      res.json(result);
    } else {
      console.error('YouTube 업로드 실패:', result.error);
      res.status(500).json(result);
    }

  } catch (error) {
    console.error('YouTube 업로드 오류:', error);
    res.status(500).json({ 
      error: 'YouTube 업로드 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
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
