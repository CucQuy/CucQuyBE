/** 1 địa chỉ cần chọn Xã: đã biết Tỉnh + danh sách Xã hợp lệ của tỉnh đó. */
export interface SpxWardInput {
  address: string; // địa chỉ tự do (có thể ghi xã/huyện cũ)
  province: string; // Tỉnh/Thành đã xác định (danh mục mới 2025)
  wards: string[]; // danh sách Phường/Xã hợp lệ của tỉnh (chép nguyên văn từ đây)
}
