const mongoose = require('mongoose');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;

const validateId = (paramName = 'id') => (req, res, next) => {
  const value = req.params[paramName];
  if (!value || !isValidObjectId(value)) {
    return res.status(400).json({ success: false, message: `Invalid ${paramName} format` });
  }
  next();
};

module.exports = { validateId, isValidObjectId };
