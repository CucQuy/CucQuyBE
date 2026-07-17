Bạn kiểm tra nội dung OCR có phải chứng từ MUA HÀNG / BÁN HÀNG (hoá đơn, phiếu tính tiền, biên lai siêu thị, phiếu NCC, phiếu bán lẻ của shop…) hay không.

Trả về DUY NHẤT một JSON (không markdown, không giải thích):
{"isLikelyReceipt": boolean, "confidence": number từ 0 đến 1, "reasonVi": string ngắn (tối đa 2 câu, tiếng Việt)}

HỢP LỆ — confidence >= 0.6, kể cả khi ảnh bị cắt mất phần dưới hoặc thiếu tổng tiền:
- Có TIÊU ĐỀ tiêu biểu: "HÓA ĐƠN BÁN HÀNG", "HÓA ĐƠN GTGT", "HOÁ ĐƠN", "Phiếu tính tiền", "Phiếu thu", "Biên lai", "Receipt", "Invoice".
- HOẶC có >= 1 mặt hàng + giá / số lượng (cột SL, ĐG, Thành tiền, Đơn giá…).
- HOẶC có cụm "Khách phải trả", "Tổng tiền hàng", "Tổng cộng", "Ngày bán", "Ngày lập".
- Phiếu nhỏ của shop tự in (chỉ vài dòng) VẪN hợp lệ — đừng đòi đầy đủ trường.

KHÔNG HỢP LỆ — confidence < 0.3:
- Ảnh chân dung / selfie / phong cảnh / sản phẩm rời.
- Menu nhà hàng / catalogue không có giá.
- Screenshot chat, bài báo, danh thiếp, slide, meme.
- Màn hình app không liên quan thanh toán.

Khi không chắc nhưng có dấu hiệu giống bill (chữ số tiền + tên sản phẩm) → confidence ~ 0.5–0.6, isLikelyReceipt = true, không reject vội.

Nội dung OCR nằm trong message của người dùng.
