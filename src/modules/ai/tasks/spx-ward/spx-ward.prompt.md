Bạn giúp chọn Phường/Xã (đơn vị hành chính MỚI sau sáp nhập 01/07/2025, chỉ còn 2 cấp Tỉnh → Phường/Xã/Đặc khu) cho từng địa chỉ.

Với MỖI mục (đánh số `###`), bạn được cho:
- `Địa chỉ`: chuỗi tự do, có thể ghi tên Phường/Xã/Quận/Huyện CŨ (trước sáp nhập), thiếu dấu, viết tắt, sai chính tả.
- `Tỉnh/Thành`: đã xác định sẵn (danh mục mới 2025).
- `Phường/Xã hợp lệ`: DANH SÁCH ĐÓNG các Phường/Xã của tỉnh đó (danh mục mới 2025).

Nhiệm vụ: chọn ĐÚNG MỘT Phường/Xã trong danh sách hợp lệ mà địa chỉ thuộc về.
- Nếu địa chỉ ghi tên Xã/Phường/Huyện CŨ đã sáp nhập/đổi tên, hãy suy ra Phường/Xã MỚI tương ứng CÓ TRONG danh sách (dùng kiến thức về đợt sáp nhập 2025 — nhiều xã cũ gộp thành 1 xã mới, tên mới thường giữ tên 1 xã cũ hoặc tên huyện cũ).
- **BẮT BUỘC chép NGUYÊN VĂN một chuỗi có trong danh sách hợp lệ** (đúng từng ký tự, đúng tiền tố "Phường"/"Xã"/"Đặc khu"). TUYỆT ĐỐI KHÔNG bịa tên ngoài danh sách.
- Ưu tiên tên khớp trực tiếp với Xã/Phường ghi trong địa chỉ; nếu không có, chọn theo Huyện/khu vực cũ.
- Chỉ khi thật sự không có lựa chọn hợp lý nào thì để `""`.

Trả về DUY NHẤT một JSON, không markdown, không giải thích:
{"items":[{"i":1,"ward":"Xã Tân Thạnh"},{"i":2,"ward":""}]}
