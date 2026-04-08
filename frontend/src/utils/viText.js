const LOCATION_NAME_MAP = {
  "Quang Tri": "Quảng Trị",
  "Thua Thien-Hue": "Thừa Thiên Huế",
  "Da Nang": "Đà Nẵng",
  "Da Nang City": "Đà Nẵng",
  "Quang Nam": "Quảng Nam",
  "Quang Ngai": "Quảng Ngãi",
  "Binh Dinh": "Bình Định",
  "Ha Noi": "Hà Nội",
  "Ha Noi City": "Hà Nội",
  "Ho Chi Minh city": "Thành phố Hồ Chí Minh",
  "Ho Chi Minh City": "Thành phố Hồ Chí Minh",
  "Can Tho city": "Cần Thơ",
  "Hai Phong City": "Hải Phòng",
};

export function toVietnameseLabel(value) {
  if (!value) {
    return value;
  }

  return LOCATION_NAME_MAP[value] || value;
}
