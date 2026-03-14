/**
 * GEE Service - Kết nối với Python Flask API để lấy dữ liệu từ Google Earth Engine
 */

import axios from 'axios';

const PYTHON_API_URL = 'http://127.0.0.1:3001';

class GEEService {
  /**
   * Kiểm tra Python API có hoạt động không
   */
  static async checkStatus() {
    try {
      const response = await axios.get(`${PYTHON_API_URL}/status`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('❌ Python GEE API not available:', error.message);
      return { status: 'offline', gee_initialized: false };
    }
  }

  /**
   * Lấy dữ liệu từ GEE và lưu vào database
   * @param {Object} params - Tham số tìm kiếm
   * @param {string} params.province - Tên tỉnh (vd: "Quang Tri")
   * @param {number} params.location_id - ID location trong database
   * @param {string} params.start_date - Ngày bắt đầu (YYYY-MM-DD)
   * @param {string} params.end_date - Ngày kết thúc (YYYY-MM-DD)
   * @param {Array<string>} params.data_types - Loại dữ liệu cần lấy
   * @returns {Promise<Object>} Kết quả
   */
  static async fetchData(params) {
    const { province, location_id, start_date, end_date, data_types } = params;

    // Validate
    if (!province || !location_id || !start_date || !end_date) {
      throw new Error('Missing required parameters');
    }

    if (!data_types || data_types.length === 0) {
      throw new Error('At least one data type must be selected');
    }

    try {
      console.log('🌍 Fetching data from GEE...');
      console.log('  Province:', province);
      console.log('  Period:', start_date, 'to', end_date);
      console.log('  Types:', data_types.join(', '));

      const response = await axios.post(
        `${PYTHON_API_URL}/fetch-data`,
        {
          province,
          location_id,
          start_date,
          end_date,
          data_types
        },
        {
          timeout: 600000 // 10 phút timeout (GEE có thể mất nhiều thời gian)
        }
      );

      if (response.data.success) {
        console.log('✅ Data fetched successfully');
        return {
          success: true,
          data: response.data
        };
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }

    } catch (error) {
      console.error('❌ Error fetching from GEE:', error.message);
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Python GEE API is not running. Please start it with: python api_server.py');
      }
      
      if (error.response) {
        throw new Error(error.response.data.error || error.response.statusText);
      }
      
      throw error;
    }
  }

  /**
   * Lấy chỉ dữ liệu lượng mưa
   */
  static async fetchRainfall(province, location_id, start_date, end_date) {
    return this.fetchData({
      province,
      location_id,
      start_date,
      end_date,
      data_types: ['rainfall']
    });
  }

  /**
   * Lấy chỉ dữ liệu nhiệt độ
   */
  static async fetchTemperature(province, location_id, start_date, end_date) {
    return this.fetchData({
      province,
      location_id,
      start_date,
      end_date,
      data_types: ['temperature']
    });
  }

  /**
   * Lấy tất cả dữ liệu
   */
  static async fetchAll(province, location_id, start_date, end_date) {
    return this.fetchData({
      province,
      location_id,
      start_date,
      end_date,
      data_types: ['rainfall', 'temperature', 'soil_moisture', 'ndvi', 'tvdi']
    });
  }
}

export default GEEService;