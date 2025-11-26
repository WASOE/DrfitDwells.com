const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MB = 1024 * 1024;
const MAX_SIZE = 8 * MB;
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params; // cabin id
    const dir = path.join(__dirname, '..', '..', 'uploads', 'cabins', id, 'original');
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

module.exports = { upload };

