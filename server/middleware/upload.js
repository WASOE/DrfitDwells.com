const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MAGIC_BYTES = {
  jpg: [Buffer.from([0xFF, 0xD8, 0xFF])],
  png: [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  webp: [Buffer.from('RIFF'), Buffer.from('WEBP')]
};

function validateMagicBytes(filePath, ext) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);

    if (ext === '.jpg' || ext === '.jpeg') {
      return buf.subarray(0, 3).equals(MAGIC_BYTES.jpg[0]);
    }
    if (ext === '.png') {
      return buf.subarray(0, 4).equals(MAGIC_BYTES.png[0]);
    }
    if (ext === '.webp') {
      return buf.subarray(0, 4).equals(MAGIC_BYTES.webp[0]) &&
             buf.subarray(8, 12).equals(MAGIC_BYTES.webp[1]);
    }
    return false;
  } catch {
    return false;
  }
}

const MB = 1024 * 1024;
const MAX_SIZE = 8 * MB;
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params;
    const sanitizedId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitizedId || sanitizedId !== id) {
      return cb(new Error('Invalid cabin ID'));
    }
    const dir = path.join(__dirname, '..', '..', 'uploads', 'cabins', sanitizedId, 'original');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '-').slice(0, 80);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}-${base}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.has(ext)) return cb(new Error('Only JPG/PNG/WebP allowed'), false);
  cb(null, true);
};

const upload = multer({ 
  storage, 
  fileFilter, 
  limits: { fileSize: MAX_SIZE },
  onError: (err, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const error = new Error('File too large. Maximum size is 8MB.');
      error.status = 413;
      return next(error);
    }
    next(err);
  }
});

module.exports = { upload, validateMagicBytes };

