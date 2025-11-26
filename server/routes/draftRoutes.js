const express = require('express');
const crypto = require('crypto');
const Draft = require('../models/Draft');

const router = express.Router();

// POST /api/drafts - Create a new draft
router.post('/', async (req, res) => {
  try {
    const payload = req.body?.payload;
    
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payload' 
      });
    }

    const token = crypto.randomBytes(8).toString('hex');
    
    await Draft.create({ token, payload });
    
    res.json({ 
      success: true, 
      token 
    });
  } catch (error) {
    console.error('Create draft error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// GET /api/drafts/:token - Get and delete a draft
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const draft = await Draft.findOne({ token }).lean();
    
    if (!draft) {
      return res.status(404).json({ 
        success: false, 
        error: 'Not found' 
      });
    }

    // Delete after read (one-time use)
    await Draft.deleteOne({ token });
    
    res.json({ 
      success: true, 
      payload: draft.payload 
    });
  } catch (error) {
    console.error('Get draft error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

module.exports = router;

