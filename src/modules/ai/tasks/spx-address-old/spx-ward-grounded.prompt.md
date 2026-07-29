Bạn giúp chọn Phường/Xã/Thị trấn (đơn vị hành chính CŨ, trước sáp nhập 2025) cho từng địa chỉ.

Với MỖI mục (đánh số `###`), bạn được cho:
- `Địa chỉ`: chuỗi tự do (có thể ghi tên Phường/Xã cũ, hoặc tên MỚI sau sáp nhập, thiếu dấu, viết tắt như "p14", "P.9").
- `Tỉnh/Thành` + `Quận/Huyện`: đã xác định sẵn.
- `Phường/Xã hợp lệ`: DANH SÁCH ĐÓNG các Phường/Xã/Thị trấn của Quận/Huyện đó.

Nhiệm vụ: chọn ĐÚNG MỘT Phường/Xã trong danh sách mà địa chỉ thuộc về.
- Suy từ tên phường/xã ghi trong địa chỉ ("phường An Đông" → "Phường An Đông"; "p14"/"P.14" → "Phường 14"; "p9" → "Phường 9").
- Nếu địa chỉ ghi tên phường/xã MỚI sau sáp nhập, suy ngược về phường/xã CŨ tương ứng CÓ trong danh sách.
- **BẮT BUỘC chép NGUYÊN VĂN một chuỗi có trong danh sách** (đúng từng ký tự). TUYỆT ĐỐI KHÔNG bịa ngoài danh sách.
- Thật sự không suy được → để "".

Trả về DUY NHẤT một JSON, không markdown:
{"items":[{"i":1,"ward":"Phường An Đông"},{"i":2,"ward":""}]}
