FROM node:18-slim

# FFmpeg와 폰트 설치
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto-cjk \
    fonts-dejavu-core \
    fontconfig \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 폰트 캐시 업데이트
RUN fc-cache -fv

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 애플리케이션 코드 복사
COPY . .

# 업로드 및 출력 디렉토리 생성
RUN mkdir -p uploads output

# 포트 노출
EXPOSE 3000

# 애플리케이션 시작
CMD ["node", "server.js"]
