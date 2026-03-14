// Tính xu hướng tuyến tính (Linear Regression)
export function calculateTrend(data) {
  if (!data || data.length < 2) {
    return { slope: 0, trend: "insufficient_data" };
  }

  const n = data.length;
  const sumX = data.reduce((sum, d) => sum + d.x, 0);
  const sumY = data.reduce((sum, d) => sum + d.y, 0);
  const sumXY = data.reduce((sum, d) => sum + d.x * d.y, 0);
  const sumX2 = data.reduce((sum, d) => sum + d.x * d.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  let trend = "stable";
  if (slope > 0.5) trend = "increasing";
  else if (slope < -0.5) trend = "decreasing";

  return {
    slope: slope.toFixed(4),
    intercept: intercept.toFixed(4),
    trend,
    description: getTrendDescription(trend, slope)
  };
}

function getTrendDescription(trend, slope) {
  if (trend === "increasing") {
    return `Xu hướng tăng (${slope > 5 ? "mạnh" : "nhẹ"})`;
  } else if (trend === "decreasing") {
    return `Xu hướng giảm (${slope < -5 ? "mạnh" : "nhẹ"})`;
  }
  return "Xu hướng ổn định";
}

// Tính độ lệch so với trung bình (Anomaly)
export function calculateAnomaly(currentValue, historicalData) {
  if (!historicalData || historicalData.length === 0) {
    return { anomaly: 0, percentage: 0 };
  }

  const mean = historicalData.reduce((sum, val) => sum + val, 0) / historicalData.length;
  const stdDev = Math.sqrt(
    historicalData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalData.length
  );

  const anomaly = currentValue - mean;
  const percentage = mean !== 0 ? (anomaly / mean) * 100 : 0;
  const zScore = stdDev !== 0 ? anomaly / stdDev : 0;

  return {
    anomaly: anomaly.toFixed(2),
    percentage: percentage.toFixed(2),
    z_score: zScore.toFixed(2),
    interpretation: getAnomalyInterpretation(zScore)
  };
}

function getAnomalyInterpretation(zScore) {
  const absZ = Math.abs(zScore);
  if (absZ < 1) return "Bình thường";
  if (absZ < 2) return "Hơi bất thường";
  if (absZ < 3) return "Bất thường";
  return "Rất bất thường";
}

// Format ngày tháng
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Tính trung bình động (Moving Average)
export function calculateMovingAverage(data, window = 7) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) {
      result.push(null);
    } else {
      const slice = data.slice(i - window + 1, i + 1);
      const avg = slice.reduce((sum, val) => sum + val, 0) / window;
      result.push(avg);
    }
  }
  return result;
}

// Phân loại mức độ mưa
export function classifyRainfall(mm) {
  if (mm < 0.1) return { level: "no_rain", description: "Không mưa" };
  if (mm < 2.5) return { level: "light", description: "Mưa nhỏ" };
  if (mm < 10) return { level: "moderate", description: "Mưa vừa" };
  if (mm < 50) return { level: "heavy", description: "Mưa to" };
  return { level: "very_heavy", description: "Mưa rất to" };
}

// Tính tổng theo khoảng thời gian
export function aggregateByPeriod(data, period = "month") {
  const grouped = {};
  
  data.forEach(item => {
    const date = new Date(item.date);
    let key;
    
    if (period === "month") {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else if (period === "year") {
      key = date.getFullYear().toString();
    } else if (period === "week") {
      const weekNum = getWeekNumber(date);
      key = `${date.getFullYear()}-W${weekNum}`;
    }
    
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  });
  
  return grouped;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}