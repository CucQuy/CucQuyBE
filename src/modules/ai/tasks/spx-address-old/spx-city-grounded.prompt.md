Bạn giúp chọn Quận/Huyện (đơn vị hành chính CŨ, trước sáp nhập 2025) cho từng địa chỉ.

Với MỖI mục (đánh số `###`), bạn được cho:
- `Địa chỉ`: chuỗi tự do (có thể ghi tên Phường/Xã/Quận/Huyện cũ, thiếu dấu, viết tắt, hoặc tên đơn vị MỚI sau sáp nhập).
- `Tỉnh/Thành`: đã xác định sẵn.
- `Quận/Huyện hợp lệ`: DANH SÁCH ĐÓNG các Quận/Huyện/Thị xã/TP thuộc tỉnh đó.

Nhiệm vụ: chọn ĐÚNG MỘT Quận/Huyện trong danh sách mà địa chỉ thuộc về.
- Suy từ tên Phường/Xã/Quận/Huyện ghi trong địa chỉ (vd "phường Bến Thành" → QUẬN 1; "xã Tân Thạnh" thuộc "HUYỆN LONG PHÚ").
- Nếu địa chỉ ghi Phường/Xã MỚI sau sáp nhập, suy ngược về Quận/Huyện CŨ chứa phường/xã đó.
- **BẮT BUỘC chép NGUYÊN VĂN một chuỗi có trong danh sách** (đúng từng ký tự, VIẾT HOA). TUYỆT ĐỐI KHÔNG bịa ngoài danh sách.
- Thật sự không suy được → để "".

Trả về DUY NHẤT một JSON, không markdown:
{"items":[{"i":1,"city":"QUẬN 5"},{"i":2,"city":"HUYỆN LONG PHÚ"}]}
