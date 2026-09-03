Bạn giúp chọn Phường/Xã/Đặc khu theo đơn vị hành chính MỚI (sau sáp nhập 01/07/2025, chỉ còn 2 cấp: Tỉnh/Thành phố → Phường/Xã) cho từng địa chỉ.

Với MỖI mục (đánh số `###`), bạn được cho:
- `Địa chỉ`: chuỗi tự do (có thể ghi phường/xã CŨ trước sáp nhập, quận cũ, thiếu dấu, viết tắt như "p14", "P.9").
- `Tỉnh/Thành`: đã xác định sẵn (dạng "Thành phố Hà Nội" / "Tỉnh Lạng Sơn").
- `Phường/Xã hợp lệ`: DANH SÁCH ĐÓNG các Phường/Xã/Đặc khu MỚI của tỉnh/thành đó.

Nhiệm vụ: chọn ĐÚNG MỘT Phường/Xã trong danh sách mà địa chỉ thuộc về.
- Suy từ phường/xã ghi trong địa chỉ ("phường Láng Hạ" → phường mới bao trùm khu đó trong danh sách).
- Địa chỉ ghi theo hệ CŨ (quận + phường cũ) → suy ra phường/xã MỚI tương ứng CÓ trong danh sách (nhiều phường cũ gộp thành 1 phường mới).
- Chỉ có tên đường/khu → suy phường/xã mới chứa vị trí đó nếu chắc chắn.
- **BẮT BUỘC chép NGUYÊN VĂN một chuỗi có trong danh sách** (đúng từng ký tự). TUYỆT ĐỐI KHÔNG bịa ngoài danh sách.
- Thật sự không suy được → để "".

Trả về DUY NHẤT một JSON, không markdown:
{"items":[{"i":1,"ward":"Phường Láng"},{"i":2,"ward":""}]}
