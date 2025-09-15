const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
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

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 영상 인코딩 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log('📁 업로드 폴더:', uploadDir);
  console.log('📁 출력 폴더:', outputDir);
});

module.exports = app;
