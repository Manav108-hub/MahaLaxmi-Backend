import AWS from 'aws-sdk';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const s3 = new AWS.S3();

export interface UploadResponse {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

export class S3Service {
  private static instance: S3Service;
  private bucketName = process.env.S3_BUCKET_NAME!;

  public static getInstance(): S3Service {
    if (!S3Service.instance) {
      S3Service.instance = new S3Service();
    }
    return S3Service.instance;
  }

  // Multer configuration for S3 upload
  getUploadMiddleware() {
    return multer({
      storage: multerS3({
        s3: s3Client,
        bucket: this.bucketName,
        metadata: (req, file, cb) => {
          cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const extension = file.originalname.split('.').pop();
          cb(null, `products/${uniqueSuffix}.${extension}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed!'));
        }
      },
    });
  }

  async uploadFile(file: Buffer, key: string, contentType: string): Promise<UploadResponse> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: file,
        ContentType: contentType,
      };

      const result = await s3.upload(params).promise();
      
      return {
        success: true,
        url: result.Location,
        key: result.Key,
      };
    } catch (error) {
      console.error('S3 upload error:', error);
      return {
        success: false,
        error: 'Failed to upload file',
      };
    }
  }

  async deleteFile(key: string): Promise<boolean> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      await s3.deleteObject(params).promise();
      return true;
    } catch (error) {
      console.error('S3 delete error:', error);
      return false;
    }
  }

  async deleteFiles(keys: string[]): Promise<boolean> {
    try {
      const params = {
        Bucket: this.bucketName,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
        },
      };

      await s3.deleteObjects(params).promise();
      return true;
    } catch (error) {
      console.error('S3 bulk delete error:', error);
      return false;
    }
  }

  getSignedUrl(key: string, expires: number = 3600): string {
    return s3.getSignedUrl('getObject', {
      Bucket: this.bucketName,
      Key: key,
      Expires: expires,
    });
  }
}

export const s3Service = S3Service.getInstance();