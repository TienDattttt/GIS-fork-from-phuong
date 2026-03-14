/**
 * GEE Routes - API endpoints để lấy dữ liệu từ Google Earth Engine
 */

import express from 'express';
import GEEService from '../services/geeService.js';

const router = express.Router();

/**
 * GET /api/gee/status
 * Kiểm tra Python GEE API có hoạt động không
 */
router.get('/status', async (req, res) => {
  try {
    const status = await GEEService.checkStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to check GEE service status',
      message: error.message 
    });
  }
});

/**
 * POST /api/gee/fetch
 * Lấy dữ liệu từ GEE và lưu vào database
 * 
 * Body:
 * {
 *   "province": "Quang Tri",
 *   "location_id": 1,
 *   "start_date": "2020-01-01",
 *   "end_date": "2020-12-31",
 *   "data_types": ["rainfall", "temperature", "soil_moisture", "ndvi", "tvdi"]
 * }
 */
router.post('/fetch', async (req, res) => {
  try {
    const { province, location_id, start_date, end_date, data_types } = req.body;

    // Validation
    if (!province || !location_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['province', 'location_id', 'start_date', 'end_date']
      });
    }

    if (!data_types || !Array.isArray(data_types) || data_types.length === 0) {
      return res.status(400).json({
        error: 'data_types must be a non-empty array',
        example: ['rainfall', 'temperature']
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Kiểm tra GEE service trước
    const status = await GEEService.checkStatus();
    if (status.status !== 'online') {
      return res.status(503).json({
        error: 'Python GEE API is not available',
        message: 'Please start the Python API server: python api_server.py',
        status: status
      });
    }

    // Lấy dữ liệu từ GEE
    console.log('📡 Fetching data from GEE...');
    const result = await GEEService.fetchData({
      province,
      location_id,
      start_date,
      end_date,
      data_types
    });

    res.json({
      success: true,
      message: 'Data fetched and saved successfully',
      province,
      location_id,
      period: `${start_date} to ${end_date}`,
      results: result.data.results
    });

  } catch (error) {
    console.error('Error in /api/gee/fetch:', error);
    res.status(500).json({
      error: 'Failed to fetch data from GEE',
      message: error.message
    });
  }
});

/**
 * POST /api/gee/fetch-rainfall
 * Lấy chỉ dữ liệu lượng mưa
 */
router.post('/fetch-rainfall', async (req, res) => {
  try {
    const { province, location_id, start_date, end_date } = req.body;
    
    const result = await GEEService.fetchRainfall(
      province, 
      location_id, 
      start_date, 
      end_date
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch rainfall data',
      message: error.message 
    });
  }
});

/**
 * POST /api/gee/fetch-temperature
 * Lấy chỉ dữ liệu nhiệt độ
 */
router.post('/fetch-temperature', async (req, res) => {
  try {
    const { province, location_id, start_date, end_date } = req.body;
    
    const result = await GEEService.fetchTemperature(
      province, 
      location_id, 
      start_date, 
      end_date
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch temperature data',
      message: error.message 
    });
  }
});

/**
 * POST /api/gee/fetch-all
 * Lấy tất cả dữ liệu
 */
router.post('/fetch-all', async (req, res) => {
  try {
    const { province, location_id, start_date, end_date } = req.body;
    
    const result = await GEEService.fetchAll(
      province, 
      location_id, 
      start_date, 
      end_date
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch all data',
      message: error.message 
    });
  }
});

export default router;