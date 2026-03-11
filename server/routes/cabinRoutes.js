const express = require('express');
const Cabin = require('../models/Cabin');
const { validateId } = require('../middleware/validateId');

const router = express.Router();

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const cabin = await Cabin.findById(req.params.id);

    if (!cabin || !cabin.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found'
      });
    }

    res.json({
      success: true,
      data: { cabin }
    });

  } catch (error) {
    console.error('Get cabin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const cabins = await Cabin.find({ isActive: true }).select('-blockedDates');

    res.json({
      success: true,
      data: { cabins }
    });

  } catch (error) {
    console.error('Get cabins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabins',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
