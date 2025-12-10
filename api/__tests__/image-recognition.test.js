const { mockClient } = require('aws-sdk-client-mock');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Mock axios before requiring the module
jest.mock('axios');
const axios = require('axios');

// Create mock
const bedrockMock = mockClient(BedrockRuntimeClient);

// Module under test
const { analyzeImage, isImageFile, downloadAndEncodeImage } = require('../image-recognition');

describe('image-recognition', () => {
  beforeEach(() => {
    bedrockMock.reset();
    jest.clearAllMocks();
  });

  describe('isImageFile', () => {
    it('should return true for PNG files', () => {
      expect(isImageFile({ mimetype: 'image/png', name: 'test.png' })).toBe(true);
    });

    it('should return true for JPEG files', () => {
      expect(isImageFile({ mimetype: 'image/jpeg', name: 'test.jpg' })).toBe(true);
    });

    it('should return true for GIF files', () => {
      expect(isImageFile({ mimetype: 'image/gif', name: 'test.gif' })).toBe(true);
    });

    it('should return true for WebP files', () => {
      expect(isImageFile({ mimetype: 'image/webp', name: 'test.webp' })).toBe(true);
    });

    it('should return false for text files', () => {
      expect(isImageFile({ mimetype: 'text/plain', name: 'test.txt' })).toBe(false);
    });

    it('should return false for PDF files', () => {
      expect(isImageFile({ mimetype: 'application/pdf', name: 'test.pdf' })).toBe(false);
    });

    it('should handle missing mimetype by checking extension', () => {
      expect(isImageFile({ name: 'photo.jpg' })).toBe(true);
      expect(isImageFile({ name: 'document.txt' })).toBe(false);
    });
  });

  describe('downloadAndEncodeImage', () => {
    it('should download image and return base64 encoded data', async () => {
      const mockImageBuffer = Buffer.from('fake image data');

      axios.get.mockResolvedValue({
        data: mockImageBuffer
      });

      const file = {
        url_private_download: 'https://files.slack.com/test.png',
        mimetype: 'image/png'
      };
      const token = 'xoxb-test-token';

      const result = await downloadAndEncodeImage(file, token);

      expect(result).toEqual({
        base64: mockImageBuffer.toString('base64'),
        mediaType: 'image/png'
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://files.slack.com/test.png',
        expect.objectContaining({
          headers: { 'Authorization': 'Bearer xoxb-test-token' }
        })
      );
    });

    it('should throw error for unsupported image format', async () => {
      const file = {
        url_private_download: 'https://files.slack.com/test.bmp',
        mimetype: 'image/bmp'
      };

      await expect(downloadAndEncodeImage(file, 'token'))
        .rejects
        .toThrow('Unsupported image format');
    });
  });

  describe('analyzeImage', () => {
    it('should return description for valid image', async () => {
      const mockResponse = {
        content: [{
          text: 'この画像にはサイコロが写っています。2つのサイコロがあり、それぞれ異なる面を見せています。'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      const imageData = {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mediaType: 'image/png'
      };
      const prompt = 'この画像に何が写っているか教えて';

      const result = await analyzeImage(imageData, prompt);

      expect(result).toBe(mockResponse.content[0].text);
      expect(bedrockMock.commandCalls(InvokeModelCommand)).toHaveLength(1);

      // Verify multimodal request format
      const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
      const payload = JSON.parse(call.args[0].input.body);

      expect(payload.messages[0].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'image' }),
          expect.objectContaining({ type: 'text' })
        ])
      );
    });

    it('should use default prompt when not provided', async () => {
      const mockResponse = {
        content: [{
          text: '画像の説明です'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      const imageData = {
        base64: 'base64data',
        mediaType: 'image/png'
      };

      await analyzeImage(imageData);

      const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
      const payload = JSON.parse(call.args[0].input.body);
      const textContent = payload.messages[0].content.find(c => c.type === 'text');

      expect(textContent.text).toContain('この画像');
    });

    it('should return null for empty image data', async () => {
      const result = await analyzeImage(null);
      expect(result).toBeNull();
    });

    it('should return null for empty base64', async () => {
      const result = await analyzeImage({ base64: '', mediaType: 'image/png' });
      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      bedrockMock.on(InvokeModelCommand).rejects(new Error('API Error'));

      const imageData = {
        base64: 'base64data',
        mediaType: 'image/png'
      };

      await expect(analyzeImage(imageData, 'test'))
        .rejects
        .toThrow('API Error');
    });
  });
});
