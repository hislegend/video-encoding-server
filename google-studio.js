const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

class GoogleStudioAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://www.googleapis.com/upload/youtube/v3';
  }

  /**
   * YouTube에 비디오 업로드
   * @param {string} filePath - 업로드할 비디오 파일 경로
   * @param {Object} metadata - 비디오 메타데이터
   * @returns {Promise<Object>} 업로드 결과
   */
  async uploadVideo(filePath, metadata = {}) {
    try {
      if (!this.apiKey) {
        throw new Error('Google API 키가 설정되지 않았습니다.');
      }

      if (!fs.existsSync(filePath)) {
        throw new Error('업로드할 파일을 찾을 수 없습니다.');
      }

      const videoMetadata = {
        snippet: {
          title: metadata.title || '인코딩된 비디오',
          description: metadata.description || 'Video Encoding Server로 인코딩된 비디오입니다.',
          tags: metadata.tags || ['video', 'encoding', 'automated'],
          categoryId: '22', // People & Blogs
          defaultLanguage: 'ko',
          defaultAudioLanguage: 'ko'
        },
        status: {
          privacyStatus: metadata.privacy || 'private', // private, unlisted, public
          selfDeclaredMadeForKids: false
        }
      };

      // 먼저 메타데이터로 비디오 리소스 생성
      const insertResponse = await axios.post(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&key=${this.apiKey}`,
        videoMetadata,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const videoId = insertResponse.data.id;

      // 실제 비디오 파일 업로드
      const formData = new FormData();
      formData.append('video', fs.createReadStream(filePath));

      const uploadResponse = await axios.put(
        `${this.baseURL}/videos?uploadType=resumable&part=snippet&key=${this.apiKey}`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${this.apiKey}`
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      return {
        success: true,
        videoId: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        message: 'YouTube에 성공적으로 업로드되었습니다.'
      };

    } catch (error) {
      console.error('YouTube 업로드 오류:', error);
      
      if (error.response) {
        return {
          success: false,
          error: `YouTube API 오류: ${error.response.data.error?.message || error.response.statusText}`,
          statusCode: error.response.status
        };
      }
      
      return {
        success: false,
        error: error.message || 'YouTube 업로드 중 알 수 없는 오류가 발생했습니다.'
      };
    }
  }

  /**
   * API 키 유효성 검사
   * @returns {Promise<boolean>} API 키 유효 여부
   */
  async validateApiKey() {
    try {
      const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&key=${this.apiKey}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );
      
      return response.status === 200;
    } catch (error) {
      console.error('API 키 검증 오류:', error);
      return false;
    }
  }

  /**
   * 업로드 진행률 콜백 설정
   * @param {Function} callback - 진행률 콜백 함수
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }
}

module.exports = GoogleStudioAPI;
