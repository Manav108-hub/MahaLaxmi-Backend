import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import dotenv from 'dotenv';

dotenv.config();

// Create S3 client (v3)
const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Multer S3 configuration
export const uploadToS3 = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET_NAME!,
    // acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (
      req: Express.Request,
      file: Express.Multer.File,
      cb: (error: Error | null, key?: string) => void
    ) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const fileExtension = file.originalname.split('.').pop();
      const fileName = `products/${uniqueSuffix}.${fileExtension}`;
      cb(null, fileName); // No error, provide the key
    },
  }),
  fileFilter: (req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true); // No error, accept the file
    } else {
      // Create an error and pass it to the callback, along with false to reject the file
      cb(null, false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Export as 'upload' for backward compatibility
export const upload = uploadToS3;

// Delete file from S3
export const deleteFromS3 = async (fileUrl: string): Promise<boolean> => {
  try {
    const parts = fileUrl.split('/');
    
    const filename = parts.pop(); // Gets 'uniqueSuffix.extension'
    if (!filename) {
      console.error('❌ Invalid file URL: Could not extract filename.');
      return false;
    }
        
    // The key in S3 is `products/filename` as defined in the `key` function of multerS3
    const key = `products/${filename}`;
    
    const deleteCommand = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
    });
    
    await s3Client.send(deleteCommand);
    console.log(`✅ File ${key} deleted successfully from S3.`);
    return true;
  } catch (error) {
    console.error('❌ Error deleting file from S3:', error);
    return false;
  }
};