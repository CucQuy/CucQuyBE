/** Kết quả tách 1 địa chỉ → Tỉnh/Thành + Xã/Phường chuẩn (rỗng nếu không chắc). */
export interface SpxAddressResult {
  province: string; // vd "Thành phố Hồ Chí Minh" / "Tỉnh Thái Nguyên" / ''
  ward: string; // vd "Phường Bến Thành" / "Xã Xuân Lộc" / ''
}
