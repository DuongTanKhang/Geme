from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


OUT = Path(__file__).with_name("GEME_Bao_cao_chuc_nang_Admin_20261101.docx")
GREEN = "174D45"
PALE = "EAF3EF"
PALE_GOLD = "F5F0E7"
INK = "17221F"
MUTED = "66736F"
LINE = "D8E2DE"
WHITE = "FFFFFF"


def shade(cell, color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), color)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant = OxmlElement("w:cantSplit")
    tr_pr.append(cant)


def set_run_font(run, name="Arial", size=None, color=None, bold=None, italic=None):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.rFonts
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for key in ("ascii", "hAnsi", "cs", "eastAsia"):
        rfonts.set(qn(f"w:{key}"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def set_cell_text(cell, text, bold=False, color=INK, size=9.0):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1.08
    run = p.add_run(str(text))
    set_run_font(run, size=size, color=color, bold=bold)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    set_cell_margins(cell)


def add_page_field(paragraph, field):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = field
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])
    set_run_font(run, size=8, color=MUTED)


doc = Document()
sec = doc.sections[0]
sec.page_width = Inches(8.27)
sec.page_height = Inches(11.69)
sec.top_margin = Inches(0.68)
sec.bottom_margin = Inches(0.68)
sec.left_margin = Inches(0.78)
sec.right_margin = Inches(0.78)
sec.header_distance = Inches(0.3)
sec.footer_distance = Inches(0.32)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Arial"
normal.font.size = Pt(10)
normal.font.color.rgb = RGBColor.from_string(INK)
normal._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.line_spacing = 1.12

for style_name, size, before, after in (("Title", 27, 0, 10), ("Subtitle", 13, 0, 12), ("Heading 1", 17, 14, 7), ("Heading 2", 12.5, 9, 4), ("Heading 3", 10.5, 7, 3)):
    st = styles[style_name]
    st.font.name = "Arial" if style_name != "Title" else "Georgia"
    st.font.size = Pt(size)
    st.font.bold = style_name != "Subtitle"
    st.font.color.rgb = RGBColor.from_string(INK)
    st._element.rPr.rFonts.set(qn("w:ascii"), st.font.name)
    st._element.rPr.rFonts.set(qn("w:hAnsi"), st.font.name)
    st._element.rPr.rFonts.set(qn("w:eastAsia"), st.font.name)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True
    st.paragraph_format.keep_together = True

for name in ("List Bullet", "List Number"):
    styles[name].font.name = "Arial"
    styles[name].font.size = Pt(9.7)
    styles[name]._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    styles[name].paragraph_format.space_after = Pt(2)

# Restrained running header/footer for a multi-page management report.
header = sec.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
header.paragraph_format.space_after = Pt(0)
r = header.add_run("GEME  |  BÁO CÁO QUẢN TRỊ ADMIN")
set_run_font(r, size=8, color=MUTED, bold=True)
footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer.paragraph_format.space_before = Pt(0)
footer.paragraph_format.space_after = Pt(0)
r = footer.add_run("Tài liệu nội bộ  •  01/11/2026  •  Trang ")
set_run_font(r, size=8, color=MUTED)
add_page_field(footer, "PAGE")
r = footer.add_run(" / ")
set_run_font(r, size=8, color=MUTED)
add_page_field(footer, "NUMPAGES")


def p(text="", style=None, bold_lead=None, color=None, italic=False, keep=False):
    para = doc.add_paragraph(style=style)
    if bold_lead and text.startswith(bold_lead):
        a = para.add_run(bold_lead)
        set_run_font(a, color=color or INK, bold=True, italic=italic)
        b = para.add_run(text[len(bold_lead):])
        set_run_font(b, color=color or INK, italic=italic)
    else:
        a = para.add_run(text)
        set_run_font(a, color=color or INK, italic=italic)
    if keep:
        para.paragraph_format.keep_together = True
    return para


def bullet(text, level=0):
    para = doc.add_paragraph(style="List Bullet")
    para.paragraph_format.left_indent = Inches(0.25 + 0.18 * level)
    para.paragraph_format.first_line_indent = Inches(-0.14)
    para.paragraph_format.keep_together = True
    run = para.add_run(text)
    set_run_font(run, size=9.6, color=INK)
    return para


def numbered(text):
    para = doc.add_paragraph(style="List Number")
    para.paragraph_format.left_indent = Inches(0.28)
    para.paragraph_format.first_line_indent = Inches(-0.16)
    para.paragraph_format.keep_together = True
    run = para.add_run(text)
    set_run_font(run, size=9.6, color=INK)
    return para


def heading(text, level=1):
    return doc.add_heading(text, level=level)


def callout(title, body, fill=PALE):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Inches(6.7)
    cell = table.cell(0, 0)
    shade(cell, fill)
    set_cell_margins(cell, top=150, start=190, bottom=145, end=190)
    cell.text = ""
    para = cell.paragraphs[0]
    para.paragraph_format.space_after = Pt(3)
    run = para.add_run(title)
    set_run_font(run, size=10, color=GREEN, bold=True)
    para = cell.add_paragraph()
    para.paragraph_format.space_after = Pt(0)
    para.paragraph_format.line_spacing = 1.1
    run = para.add_run(body)
    set_run_font(run, size=9.5, color=INK)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def table(headers, rows, widths=None, font_size=8.7):
    tbl = doc.add_table(rows=1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.style = "Table Grid"
    tbl.autofit = False
    if widths:
        for col, width in zip(tbl.columns, widths):
            col.width = Inches(width)
    for idx, title in enumerate(headers):
        cell = tbl.rows[0].cells[idx]
        shade(cell, GREEN)
        set_cell_text(cell, title, bold=True, color=WHITE, size=font_size)
    set_repeat_table_header(tbl.rows[0])
    prevent_row_split(tbl.rows[0])
    for row_index, row in enumerate(rows):
        cells = tbl.add_row().cells
        prevent_row_split(tbl.rows[-1])
        for idx, value in enumerate(row):
            if row_index % 2:
                shade(cells[idx], "F7F9F8")
            set_cell_text(cells[idx], value, size=font_size)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return tbl


def module(title, purpose, steps, controls=None, state=None):
    heading(title, 2)
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(4)
    lead = para.add_run("Mục đích. ")
    set_run_font(lead, size=9.7, color=GREEN, bold=True)
    body = para.add_run(purpose)
    set_run_font(body, size=9.7, color=INK)
    if steps:
        para = doc.add_paragraph()
        para.paragraph_format.space_after = Pt(2)
        run = para.add_run("Cách sử dụng")
        set_run_font(run, size=9.3, color=INK, bold=True)
        for item in steps:
            bullet(item)
    if controls:
        para = doc.add_paragraph()
        para.paragraph_format.space_after = Pt(2)
        run = para.add_run("Kiểm soát và lưu ý")
        set_run_font(run, size=9.3, color=INK, bold=True)
        for item in controls:
            bullet(item)
    if state:
        para = doc.add_paragraph()
        para.paragraph_format.space_after = Pt(6)
        run = para.add_run("Tình trạng: ")
        set_run_font(run, size=9.1, color=GREEN, bold=True)
        run = para.add_run(state)
        set_run_font(run, size=9.1, color=MUTED)


# Cover
doc.add_paragraph().paragraph_format.space_after = Pt(54)
eyebrow = doc.add_paragraph()
eyebrow.paragraph_format.space_after = Pt(12)
r = eyebrow.add_run("GEME  /  TÀI LIỆU QUẢN TRỊ")
set_run_font(r, size=10, color=GREEN, bold=True)
title = doc.add_paragraph(style="Title")
title.paragraph_format.space_after = Pt(12)
r = title.add_run("Báo cáo chức năng GEME Admin")
set_run_font(r, name="Georgia", size=28, color=INK, bold=True)
subtitle = doc.add_paragraph(style="Subtitle")
subtitle.paragraph_format.space_after = Pt(22)
r = subtitle.add_run("Phạm vi, công dụng và hướng dẫn vận hành")
set_run_font(r, size=13, color=MUTED)
for line, is_bold in (("Bản đối chiếu: mã nguồn Admin, API và tài liệu vận hành GEME", False), ("Ngày lập: 01 tháng 11 năm 2026", False), ("Đối tượng: Ban lãnh đạo và người phụ trách vận hành", False)):
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(5)
    rr = para.add_run(line)
    set_run_font(rr, size=10.3, color=INK, bold=is_bold)
doc.add_paragraph().paragraph_format.space_after = Pt(12)
callout("Kết luận điều hành", "GEME Admin là trung tâm quản lý hoạt động bán hàng và nội dung của GEME. Các khu vực chính đã được tổ chức thành quy trình cho đơn hàng, sản phẩm, giá, tồn kho, giao vận, chăm sóc khách, marketing, báo cáo và phân quyền. Những kết nối với POS365, SePay, Viettel Post, Meta, Shopee, email và R2 cần được xác nhận theo cấu hình từng môi trường; có màn hình trong Admin không đồng nghĩa nhà cung cấp đã được kết nối hoặc cấp quyền.")
p("Tài liệu giải thích từng khu vực, vai trò của dữ liệu và các điểm cần kiểm tra khi sử dụng. Phần trạng thái phân biệt rõ chức năng trong ứng dụng với các dịch vụ bên ngoài và các bước còn cần thao tác thủ công.", color=MUTED)

doc.add_page_break()

# Executive scope and navigation
heading("Mục lục", 1)
for item in [
    "1. Phạm vi hệ thống và cách đọc trạng thái",
    "2. Người dùng, vai trò và bảo mật truy cập",
    "3. Các chức năng trên trang quản trị",
    "4. Các luồng nghiệp vụ chính",
    "5. Tích hợp và điều kiện vận hành",
    "6. Trạng thái triển khai và nội dung cần theo dõi",
    "7. Hướng dẫn kiểm tra nhanh cho quản lý",
]:
    bullet(item)

heading("1. Phạm vi hệ thống và cách đọc trạng thái", 1)
p("Admin GEME là ứng dụng riêng, giao tiếp với NestJS API. API là lớp trung gian đọc và ghi dữ liệu vào PostgreSQL; ảnh và video được phục vụ qua kho media của hệ thống hoặc R2 theo cấu hình. Đăng nhập và OTP phụ thuộc Aegis. Admin không kết nối thẳng trình duyệt tới database.")
table(["Thành phần", "Vai trò trong vận hành", "Điểm cần hiểu"], [
    ("GEME Admin", "Giao diện nhân viên và quản trị viên dùng để xem, tạo và cập nhật nghiệp vụ.", "Quyền thao tác phụ thuộc tài khoản và quyền chức năng."),
    ("NestJS API + PostgreSQL", "Xác thực quyền, áp quy tắc nghiệp vụ, lưu sản phẩm, đơn, giá, kho, khách và nội dung.", "API là nguồn dữ liệu chính; lỗi API có thể làm thao tác lưu thất bại."),
    ("Redis và worker", "Xử lý các hàng đợi đồng bộ/tác vụ nền như Shopee, media, thanh toán hoặc gửi thư.", "Đã xếp hàng không đồng nghĩa tác vụ đã chạy thành công."),
    ("Aegis và SMTP", "Hỗ trợ đăng nhập khách hàng, OTP, khôi phục tài khoản và thư giao dịch.", "Cần cấu hình SMTP/key ở máy chủ; Admin không lưu mật khẩu SMTP."),
    ("Media database / R2", "Lưu nội dung ảnh/video và cung cấp URL công khai an toàn khi cần.", "R2 credentials luôn ở backend; Worker/cổng ảnh phải đúng host."),
], [1.35, 2.9, 2.45])
callout("Trạng thái trong báo cáo", "“Có trong ứng dụng” nghĩa là đã có màn hình hoặc luồng xử lý trong mã nguồn. “Cần cấu hình” nghĩa là phải có thông tin xác thực, callback, quyền nhà cung cấp hoặc dịch vụ chạy ở môi trường đó. “Đang cập nhật / cần đối soát thủ công” chỉ rõ giới hạn chưa được tự động hóa hoàn toàn.", fill=PALE_GOLD)

heading("2. Người dùng, vai trò và bảo mật truy cập", 1)
p("Tài khoản nội bộ được tạo trong Phân quyền. Người quản trị chọn vai trò gợi ý, sau đó chọn trang được phép mở. Quyền thao tác chi tiết được kiểm tra ở API; chỉ ẩn menu ở giao diện không thay thế kiểm tra quyền phía máy chủ.")
table(["Vai trò gợi ý", "Các trang thường được cấp", "Phù hợp với"], [
    ("Nhân viên bán hàng", "Tổng quan, Đơn hàng, Khách hàng", "Tiếp nhận đơn và hỗ trợ khách hàng."),
    ("Nhân viên vận hành", "Tổng quan, Vận hành & đối soát, Đơn hàng, Giao hàng, Tồn kho", "Xử lý đơn, kho, hãng vận chuyển và đối soát."),
    ("Nhân viên sản phẩm", "Tổng quan, Sản phẩm, Tồn kho", "Cập nhật hồ sơ đăng bán và kiểm kê."),
    ("Nhân viên nội dung", "Tổng quan, Blog, Mạng xã hội", "Soạn và quản lý nội dung truyền thông."),
    ("Tùy chỉnh", "Quản trị viên tự chọn từng trang", "Nhân sự có phạm vi công việc riêng."),
], [1.55, 2.65, 2.5])
bullet("Khi tạo nhân viên, cần tài khoản đăng nhập, mật khẩu ban đầu tối thiểu 12 ký tự, vai trò và danh sách trang được truy cập. Tên vai trò tùy chỉnh có thể dùng cho nội bộ.")
bullet("Quản trị viên có thể đặt quyền từng chức năng theo ba trạng thái: theo vai trò, cho phép hoặc từ chối; có thể khóa/mở khóa và đặt lại mật khẩu.")
bullet("Theo chính sách hiện tại, tài khoản nhân viên không tự đổi hoặc khôi phục mật khẩu; yêu cầu đổi mật khẩu đi qua quản trị viên. Super Admin không bị chỉnh quyền từ màn hình quản lý nhân viên.")
bullet("Các thay đổi quyền và thao tác quản trị có nhật ký. Nên cấp quyền tối thiểu theo nhiệm vụ và rà soát tài khoản khi nhân sự đổi vai trò hoặc nghỉ việc.")
callout("Lưu ý bảo mật", "Mật khẩu, API key, SMTP, POS365, SePay, Meta, Shopee và khóa R2 chỉ được nhập trong nơi cấu hình phía máy chủ/nhà cung cấp tương ứng. Không gửi bí mật qua chat, không ghi vào tài liệu quản trị và không đưa vào biến NEXT_PUBLIC_*.")

doc.add_page_break()
heading("3. Các chức năng trên trang quản trị", 1)
p("Các menu dưới đây phản ánh danh mục Admin trong mã nguồn hiện tại. Tên gọi có thể thay đổi nhẹ giữa bản local và host, nhưng dữ liệu nghiệp vụ được thiết kế đi qua API dùng chung.")

module("3.1 Tổng quan", "Cho quản lý xem nhanh tình hình cửa hàng và các mục cần xử lý mà không phải mở từng module.", [
    "Theo dõi các chỉ số tổng quan. Lưu ý: trong mã Admin hiện tại, bộ chọn khoảng ngày mới hiển thị thông báo và chưa lọc số liệu qua API; hãy đối chiếu thời gian trong báo cáo chuyên sâu trước khi dùng số liệu theo kỳ.",
    "Theo dõi đơn hàng gần đây, sản phẩm mới cập nhật, khuyến mãi gần đây và bài viết mới cập nhật.",
    "Dùng các nút mở danh sách để đi thẳng tới module liên quan.",
], ["Dữ liệu được tổng hợp từ đơn và sản phẩm; không nên dùng một chỉ số duy nhất thay cho đối soát thanh toán hoặc phiếu kho.", "Một số chỉ số như nguồn khách hàng chỉ chính xác nếu nguồn được ghi nhận từ trước."], "Có trong ứng dụng; số liệu phụ thuộc API và dữ liệu đã ghi nhận.")

module("3.2 Thông báo quản trị", "Tập trung sự kiện mới như khách hàng đăng ký, đơn mới, cập nhật trạng thái đơn hoặc thanh toán được ghi nhận.", [
    "Bấm biểu tượng chuông để mở danh sách thông báo và số lượng chưa đọc.",
    "Chọn một thông báo để đánh dấu đã đọc và chuyển tới ngữ cảnh liên quan nếu có.",
    "Dùng thao tác đánh dấu tất cả đã đọc sau khi đã kiểm tra các sự kiện.",
], ["Thông báo hiển thị các sự kiện API đã lưu; đây không phải hệ thống push đảm bảo tức thời khi trình duyệt đóng.", "Nếu không thấy sự kiện, kiểm tra trạng thái API và lịch sử đơn/khách trước khi kết luận dữ liệu chưa được ghi."], "Có trong ứng dụng; sự kiện chỉ xuất hiện khi API ghi nhận được.")

module("3.3 Đơn hàng", "Quản lý đơn GEME phát sinh từ website hoặc được nhân viên tạo trong Admin.", [
    "Tìm theo mã đơn hoặc thông tin khách; mở chi tiết để xem dòng hàng, SKU/biến thể, số lượng, giảm giá, phí giao, tổng tiền và ghi chú.",
    "Kiểm tra riêng trạng thái đơn, trạng thái thanh toán, trạng thái vận chuyển và trạng thái đồng bộ POS365; bốn trường này phục vụ mục đích khác nhau.",
    "Nhân viên có quyền có thể tạo đơn thủ công, cập nhật trạng thái hoặc mở biên nhận theo luồng được cấp.",
    "Dùng các trạng thái nghiệp vụ: Chờ thanh toán → Chờ xác nhận → Đang xử lý → Đang giao → Đã giao; đơn có thể chuyển Đã hủy khi còn đủ điều kiện.",
], ["Đơn QR chưa được xác nhận thanh toán vẫn ở Chờ thanh toán; sau khi nhận đủ tiền đã xác minh, đơn mới chuyển Chờ xác nhận cho Admin kiểm tra.", "Hủy đơn cần ghi lý do tối thiểu 5 ký tự. Đơn đã xuất/ghi nhận hoàn tất không được dùng thao tác hủy để tự cộng tồn.", "Giá và khuyến mãi do API tính từ dữ liệu hiện tại; số tiền trên trình duyệt không phải nguồn quyết toán."], "Có trong ứng dụng; payment status độc lập với order/shipment status.")

module("3.4 Quản lý giao hàng", "Theo dõi bước đóng gói, vận đơn và trạng thái do Viettel Post trả về.", [
    "Lọc đơn cần đóng gói/tạo vận đơn, chờ hãng lấy hàng, đang vận chuyển, giao thành công, giao lỗi/hoàn và đơn đã hủy.",
    "Mở chi tiết đơn, chọn dịch vụ và bên trả cước, lấy báo giá vận chuyển rồi tạo vận đơn/nhãn.",
    "Theo dõi mã vận đơn, phí, COD, trạng thái và vị trí mới nhất; dùng mã vận đơn khi làm việc với hãng.",
], ["Trạng thái vận đơn do Viettel Post/webhook cập nhật; giao thành công không đồng nghĩa tiền COD đã được hãng quyết toán.", "Đơn đã hủy là trạng thái đơn GEME; vận đơn hãng hủy hoặc hoàn là sự kiện vận chuyển riêng."], "Có màn hình và tích hợp API; cần token, thông tin người gửi và webhook ở môi trường muốn dùng.")

module("3.5 Vận hành & đối soát", "Gom các chỉ số và công cụ xử lý reservation tồn kho, trả hàng, hoàn tiền, COD và audit log.", [
    "Theo dõi số tồn đang giữ/khả dụng và các reservation của đơn chưa thanh toán.",
    "Tạo phiếu trả cho đơn đủ điều kiện, duyệt/từ chối, xác nhận đã nhận lại hàng và ghi nhận quyết định nhập lại kho theo từng dòng.",
    "Lập bảng kê COD với mã tham chiếu của hãng, nhập số tiền dự kiến/đã nhận/phí từng đơn rồi đối soát.",
    "Xem nhật ký quản trị để truy lại ai đã thay đổi gì và khi nào.",
], ["Phiếu hoàn tiền là chứng từ/sổ nội bộ; không tự chuyển tiền qua ngân hàng. Người phụ trách phải thực hiện giao dịch hoàn thật ở nhà cung cấp thanh toán rồi lưu đối chiếu.", "Chỉ đối soát COD cho đơn giao thành công. Chênh lệch phải ghi chú trước khi chốt bảng kê.", "Hủy/hoàn tồn phải idempotent để tránh cộng tồn hai lần; không tự sửa các bản ghi lịch sử còn mơ hồ."], "Có trong ứng dụng. Một số thao tác tài chính cần đối chiếu ngoài hệ thống.")

module("3.6 Sản phẩm và bài đăng bán", "Quản lý hồ sơ hiển thị trên Storefront; đây không phải màn hình nhập hàng.", [
    "Trong danh sách, lọc theo trạng thái, danh mục, SKU/tên, nhóm đá và nhãn Mới; xem các số tổng hợp hoạt động/ẩn/hết hàng.",
    "Chọn sản phẩm để sửa tên, mô tả ngắn/chi tiết, ảnh/video, thông tin kỹ thuật, SEO, trạng thái hiển thị và nhãn New.",
    "Khi thêm bài đăng, chọn SKU đã có trong kho; chọn nhóm sản phẩm, danh mục và đá/chất liệu phù hợp rồi rà lại các trường.",
    "Thêm ảnh, chọn ảnh bìa, sắp xếp thư viện; điền nội dung, trường kỹ thuật và thông tin SEO; lưu nháp để kiểm tra hoặc lưu và đăng.",
    "Dùng nhóm đá New Arrivals để quản lý nhóm trình bày và ánh xạ; nhãn Mới là điều kiện vào bộ sưu tập sản phẩm mới.",
], ["Một bài đăng web gắn SKU và có thể hiển thị các biến thể theo quy tắc danh mục; SKU, giá/tồn của biến thể thuộc dữ liệu kho/hồ sơ giá.", "Không tự đoán đá, chất liệu, size, chất lượng hoặc thông số. Dữ liệu chưa xác minh cần để trống hoặc chuyển người phụ trách rà soát.", "Sản phẩm đá quý cao cấp dùng nhãn Liên hệ; giao diện không nhất thiết hiển thị giá bán công khai.", "Ẩn sản phẩm chỉ thay trạng thái công bố; không được xóa ảnh, SKU, giá hay tồn."], "Có trong ứng dụng; điều kiện đăng bán được API kiểm tra theo danh mục và cấu hình sản phẩm.")

module("3.7 Hồ sơ giá", "Quản lý giá theo SKU và biến thể, tách khỏi tên sản phẩm và không thay đổi số lượng tồn.", [
    "Lọc theo danh mục, loại đá, SKU hoặc tên; bật bộ lọc thiếu giá khi cần rà soát.",
    "Mở sản phẩm/biến thể, nhập giá bán và giá gốc theo chính sách kinh doanh rồi lưu hồ sơ.",
    "Nếu POS365 đã bật đồng bộ, xem trạng thái và đưa giá vào hàng đợi đồng bộ.",
], ["Đơn hàng tính giá ở backend tại thời điểm tạo đơn; hồ sơ giá phải được cập nhật trước khi giao dịch.", "Giá sản phẩm trang sức có thể nằm trên sản phẩm; nhóm định giá biến thể/đá quý phụ thuộc danh mục.", "Với đá cao cấp, quy tắc 'Liên hệ' không thay thế yêu cầu lưu giá nhập hoặc dữ liệu kho nội bộ."], "Có trong ứng dụng; đồng bộ POS365 phụ thuộc cấu hình backend và tài khoản chi nhánh.")

module("3.8 Danh mục và loại đá", "Tổ chức cây danh mục, nhóm hàng và danh sách đá/chất liệu để hỗ trợ bộ lọc Storefront.", [
    "Dùng Danh mục để tạo/sửa/ẩn danh mục, slug, mô tả, thứ tự, ảnh và banner.",
    "Dùng Loại đá để quản lý các lựa chọn riêng theo phạm vi Trang sức hoặc Mặt đá quý; có thể bật/tắt và gắn vào danh mục áp dụng.",
    "Rà soát bộ lọc theo danh mục: chỉ đưa loại đá đang tồn tại trong nhánh sản phẩm đó vào lựa chọn của khách.",
], ["Cây danh mục có nhiều cấp; dùng đúng nhánh sản phẩm và loại đá, không biến danh sách đá toàn hệ thống thành bộ lọc chung cho mọi danh mục.", "Xóa danh mục có thể bị từ chối nếu còn sản phẩm/con phụ thuộc; trước tiên chuyển hoặc xử lý dữ liệu liên kết theo quy trình."], "Có trong ứng dụng; dữ liệu taxonomy dùng chung với Storefront.")

module("3.9 Quản lý tồn kho", "Theo dõi tồn theo SKU và biến thể, nhập/xuất, điều chỉnh và xem lịch sử thay đổi.", [
    "Tab Tồn kho hiển thị tổng, khả dụng, hàng sắp hết và hết hàng; tìm theo tên/SKU/mã vạch.",
    "Mở sản phẩm để xem tồn theo biến thể, số đã bán và lịch sử nhập/xuất gần đây.",
    "Tab Nhập kho tạo phiếu nhà cung cấp/kho/người nhận, chọn sản phẩm có sẵn bằng bộ lọc tìm SKU/tên, nhập số lượng và giá nhập rồi lưu phiếu.",
    "Tab Xuất kho ghi nhận xuất; tab Lịch sử xem biến động; tab Phiếu nhập xem chi tiết/in/đối soát phiếu POS365.",
    "Dùng cảnh báo tồn để rà SKU thấp; chỉ dùng reset hoặc xóa cứng khi đã kiểm kê và có căn cứ quản trị.",
], ["Tồn khả dụng có thể đã trừ phần đang giữ cho đơn chưa thanh toán; xem đồng thời khả dụng, đang giữ và tổng thực tế.", "Tránh nhấn gửi phiếu nhiều lần; kiểm tra phiếu vừa tạo trước khi thử lại. Phiếu đã đồng bộ POS cần theo dõi nguồn POS và trạng thái đối soát.", "Reset tồn và xóa SKU là hành động tác động dữ liệu mạnh, cần kiểm tra mã SKU, phiếu liên quan và audit trước khi xác nhận."], "Có trong ứng dụng; POS365 sync là hàng đợi, cần kiểm tra trạng thái sau khi chạy.")

module("3.10 Khách hàng", "Tra cứu hồ sơ, phương thức liên hệ và lịch sử mua hàng của từng khách.", [
    "Tìm theo tên, số điện thoại hoặc email; mở hồ sơ để xem số đơn, tổng chi tiêu, đánh giá và lịch sử mua.",
    "Tạo/cập nhật hồ sơ khi có quyền; từ hồ sơ có thể khởi tạo đơn hoặc chuyển sang chăm sóc khách.",
], ["Chỉ dùng dữ liệu cá nhân cho xử lý đơn và chăm sóc đã được phép; không xuất/chia sẻ ngoài phạm vi công việc.", "Thống kê nguồn khách hàng chỉ chính xác nếu luồng ghi nhận nguồn đã được bật và dữ liệu được lưu."], "Có trong ứng dụng; nguồn khách hàng hiện có thể thiếu dữ liệu lịch sử.")

module("3.11 Điểm thưởng", "Cấu hình chương trình, ghi nhận tích/đổi điểm và xem sổ điểm thành viên.", [
    "Kiểm tra trạng thái bật/tắt và quy tắc chương trình trước khi áp dụng cho khách.",
    "Xem thành viên đang hoạt động, tổng điểm và các bút toán gần đây.",
    "Điều chỉnh thủ công khi có căn cứ, nhập số điểm dương/âm kèm lý do để tạo dấu vết.",
], ["Chương trình mặc định có thể đang tắt; cần bật và rà quy đổi/tích điểm trước khi thông báo khách.", "Không cộng hồi tố đơn cũ nếu chưa có quyết định kinh doanh và quy trình đối soát."], "Có trong ứng dụng; chương trình cần được bật/cấu hình rõ ràng.")

module("3.12 Tin nhắn liên hệ", "Tiếp nhận yêu cầu gửi từ website và theo dõi nhân viên xử lý.", [
    "Mở hộp thư, xem nội dung/liên hệ, nhận xử lý, ghi chú, đánh dấu đã giải quyết hoặc lưu trữ.",
    "Sau khi giải quyết hoặc lưu trữ, nhập ghi chú theo mẫu modal trong Admin để lưu lại kết quả.",
], ["Ghi chú xử lý/lưu trữ hiện yêu cầu tối thiểu 5 ký tự.", "Nếu khách đã đăng nhập, một số thông tin có thể điền từ hồ sơ; cần bảo đảm có kênh phản hồi email hoặc điện thoại hợp lệ."], "Có trong ứng dụng; gửi phản hồi ra email/điện thoại có thể cần thao tác riêng.")

doc.add_page_break()
heading("3. Các chức năng trên trang quản trị (tiếp)", 1)

module("3.13 Khuyến mãi", "Tạo và quản lý chương trình giảm giá độc lập với Blog để phân quyền không bị gộp nhầm.", [
    "Tạo mã hoặc chương trình tự áp dụng; chọn kiểu phần trăm, số tiền, miễn phí giao hàng, quà tặng hoặc tích điểm nếu luồng được cấu hình.",
    "Chọn thời gian bắt đầu/kết thúc, giới hạn lượt, giá trị đơn tối thiểu, nhóm thành viên, danh mục/SKU áp dụng và SKU loại trừ.",
    "Xem trạng thái sắp diễn ra/đang chạy/đã kết thúc/tạm dừng, lượt dùng và lịch sử; tạm dừng hoặc sửa phạm vi khi cần.",
], ["Giá sau khuyến mãi phải thống nhất giữa Storefront, báo cáo và checkout; backend là nguồn tính giá.", "Quyền Khuyến mãi tách riêng khỏi Bài viết/Blog."], "Có trong ứng dụng; kiểm tra ngày giờ, phạm vi SKU và mã trước khi bật hiển thị.")

module("3.14 Bài viết / Blog", "Soạn bài Journal, quản lý chủ đề, ảnh và trạng thái xuất bản.", [
    "Tạo bài viết với tiêu đề, đoạn mở, nội dung định dạng, chủ đề, ảnh bìa và ảnh trong bài.",
    "Kiểm tra slug, SEO title, meta description, preview rồi lưu nháp hoặc xuất bản.",
    "Tìm, sửa hoặc xóa bài theo quyền được cấp; tạo loại bài ngay trong lúc soạn nếu cần.",
], ["Blog có nhóm quyền content.read/content.write riêng. HTML được xử lý an toàn ở API.", "Xuất bản bài không tự thay đổi danh mục sản phẩm hoặc giá."], "Có trong ứng dụng.")

module("3.15 Mạng xã hội", "Soạn, duyệt, lên lịch và theo dõi nội dung cho Facebook Page và Instagram Professional.", [
    "Kết nối Meta, chọn rõ Page/Instagram đích rồi lưu lựa chọn tài khoản.",
    "Soạn nội dung riêng theo kênh, gắn sản phẩm đang hoạt động/còn hàng khi phù hợp, xem giá và khuyến mãi trước khi duyệt.",
    "Lưu nháp, duyệt ngay hoặc duyệt & lên lịch; theo dõi kết quả riêng từng kênh, lịch gửi và lịch sử đối soát.",
], ["Cần Meta App, quyền Page/Instagram, callback HTTPS và có thể cần App Review/Advanced Access.", "Instagram yêu cầu tài khoản Professional liên kết Page và ảnh công khai hợp lệ; luồng hiện hỗ trợ nội dung ảnh đơn, không xử lý inbox, bình luận, quảng cáo, đơn hàng hoặc tồn kho.", "Nếu kết quả gửi là UNKNOWN do timeout, kiểm tra Meta trước khi thử lại để tránh bài đăng trùng."], "Có module; kết nối xuất bản thật phụ thuộc cấu hình Meta và quyền App.")

module("3.16 Shopee", "Kết nối shop marketplace, đọc đơn và ghép SKU GEME trong khu vực riêng.", [
    "Cấu hình backend theo môi trường Sandbox/Production; cấp quyền shop từ Admin → Shopee → Kết nối shop.",
    "Bấm Đồng bộ ngay để xếp tác vụ vào queue; kiểm tra worker, số job, lịch sử và thử lại khi lỗi.",
    "Trong Đơn Shopee, lọc theo mã đơn/SKU/trạng thái; ở Ghép SKU, ghép model SKU chính xác, xử lý SKU chưa ghép và rà mapping cũ.",
], ["Shopee yêu cầu Partner ID/Key, redirect/callback, khóa mã hóa token và App/permission của đúng môi trường.", "Đơn Shopee được lưu riêng ở module marketplace; hiện không tự nhập thành đơn GEME, không trừ tồn website, không tạo vận đơn, không đồng bộ POS365 và không vào báo cáo doanh thu GEME.", "Không bật Production chỉ bằng cách đổi biến; cần app được duyệt và seller cấp quyền thật."], "Có giao diện/API/worker; trạng thái kết nối thật phải kiểm tra ở từng môi trường.")

module("3.17 Banner, Footer và thư viện media", "Quản lý nội dung đầu trang/chân trang và các khối biên tập của Storefront.", [
    "Tab Banner thêm/sửa tiêu đề, mô tả, ảnh/video, CTA, link đích và trạng thái bật.",
    "Tab Footer cập nhật thông tin liên hệ, nhóm liên kết, mạng xã hội và phương thức thanh toán hiển thị.",
    "Tab Ảnh & Video Trang sức/New Arrivals quản lý các khối biên tập và vị trí chèn; tab Thư viện ảnh tra cứu media đã lưu.",
], ["Xem thử trên desktop và mobile sau khi đổi ảnh/banner; dùng đúng tỉ lệ và kiểm tra URL HTTPS công khai.", "Ảnh/video công khai không làm cho mọi tài liệu riêng tư trở thành public; giữ chính sách bucket và media gateway."], "Có trong ứng dụng; việc tải/xem ảnh phụ thuộc media storage và URL Worker của môi trường.")

module("3.18 Báo cáo và doanh thu", "Tổng hợp kết quả kinh doanh theo thời gian, danh mục, sản phẩm, khách, ưu đãi, phương thức thanh toán và kênh.", [
    "Báo cáo tổng quan hiển thị giá trị đơn, tiền đã thu, hoàn tiền đã ghi nhận, hàng trả, COD chưa đối soát và các bảng xếp hạng.",
    "Mở các phần Sản phẩm bán chạy, Khách hàng, Đơn hàng và Hiệu quả khuyến mãi để phân tích chi tiết.",
    "Báo cáo doanh thu bổ sung phân tích theo kênh bán, đơn giá trị cao và phần nhận xét dựa trên số liệu có sẵn.",
], ["Doanh thu, tiền đã thu, giá trị hoàn và khoản COD chờ là các chỉ số khác nhau; phải đọc cùng trạng thái thanh toán và đối soát.", "Báo cáo không tự xác nhận số tiền từ ngân hàng; nguồn xác nhận là SePay/POS hoặc chứng từ đối soát."], "Có trong ứng dụng; một số phân tích chỉ đúng khi dữ liệu nguồn được ghi đầy đủ.")

module("3.19 Cài đặt", "Thiết lập thông tin cửa hàng và xem tình trạng các kết nối chạy ở backend.", [
    "Cập nhật tên cửa hàng, email hỗ trợ, số điện thoại và địa chỉ.",
    "Trong POS365, kiểm tra kết nối, xem trạng thái queue và thao tác đồng bộ ảnh, tồn hiện tại, giá hoặc đơn cũ khi được bật.",
    "Xem trạng thái API và hướng dẫn vị trí cấu hình Shopee/SePay ở backend.",
], ["Không nhập bank QR tĩnh trong Admin: GEME lấy một tài khoản đang hoạt động từ SePay API để tạo QR theo đơn.", "POS365 có thể tách kiểm tra đọc dữ liệu với quyền ghi. Trước khi bật ghi ở staging, xác nhận đúng chi nhánh và chấp nhận ảnh hưởng tới POS thật.", "Secret nằm trong env/secrets backend, không hiển thị trong Admin."], "Có trong ứng dụng; mỗi tích hợp có trạng thái/cấu hình riêng theo local, test và production.")

module("3.20 Phân quyền", "Tạo tài khoản nhân viên và giới hạn trang/chức năng phù hợp với công việc.", [
    "Mở Phân quyền, tạo username và mật khẩu ban đầu; chọn vai trò gợi ý hoặc Tùy chỉnh.",
    "Đánh dấu các trang được phép truy cập; sau khi tạo, chọn tài khoản để đặt quyền chi tiết.",
    "Lưu quyền, khóa/mở khóa tài khoản hoặc đặt lại mật khẩu khi nhân viên cần hỗ trợ.",
], ["Khuyến mãi và Blog có quyền độc lập.", "Không cấp quyền tài chính/đối soát, xóa sản phẩm, thay giá hoặc quản lý quyền cho mọi nhân viên theo mặc định.", "Quyền của Super Admin là quyền quản trị toàn hệ thống và không sửa tại màn hình tài khoản thường."], "Có trong ứng dụng và được kiểm tra lại phía API.")

doc.add_page_break()

# Key workflows
heading("4. Các luồng nghiệp vụ chính", 1)
heading("4.1 Từ hàng trong kho đến sản phẩm bán trên website", 2)
for item in [
    "Kiểm tra danh mục/loại đá và SKU trước khi nhập kho. SKU phải là mã đúng của sản phẩm hoặc biến thể; không tự tạo mã theo suy đoán.",
    "Tạo phiếu nhập, nhập số lượng và giá nhập, lưu một lần; sau đó kiểm tra phiếu trong Lịch sử/Phiếu nhập và trạng thái POS365 nếu bật đồng bộ.",
    "Tạo bài đăng từ SKU còn trong kho. Chọn đúng danh mục, đá/chất liệu và các biến thể; bổ sung tên, mô tả, thông tin kỹ thuật, ảnh, giá từ hồ sơ giá và thông tin SEO.",
    "Lưu nháp để rà nội dung/ảnh/giá/tồn; chỉ chọn đăng sau khi sản phẩm đáp ứng điều kiện công bố. Kiểm tra sản phẩm ở Storefront và đối chiếu cùng SKU ở POS.",
]: numbered(item)
callout("Kết quả mong đợi", "Một sản phẩm web có thể là một bài đăng đại diện cho nhiều SKU biến thể. Bản ghi kho/giá theo SKU vẫn là nguồn cho giá và tồn của lựa chọn khách mua.")

heading("4.2 Thanh toán QR và xác nhận đơn", 2)
for item in [
    "Khách chọn chuyển khoản QR; GEME tạo mã QR theo tổng đơn, kèm nội dung thanh toán có mã đơn và bắt đầu bộ đếm 15 phút.",
    "Trong thời gian chờ, trạng thái đơn là Chờ thanh toán và khách có thể mở lại nút thanh toán để quét lại QR.",
    "SePay gửi webhook; API kiểm tra chữ ký HMAC, tài khoản nhận, mã GEME, tính duy nhất sự kiện, trạng thái đơn và số tiền đủ chính xác.",
    "Khi nhận đủ tiền hợp lệ, thanh toán được lưu và đơn chuyển Chờ xác nhận; QR/nút thanh toán lại không còn cần hiển thị.",
    "GEME đưa thông tin đã thanh toán sang queue POS365 nếu tích hợp ghi đang bật; Admin kiểm tra trạng thái đồng bộ riêng.",
]: numbered(item)
callout("Ngoại lệ cần xử lý", "Sai mã, thiếu/thừa tiền, chuyển sau hạn, tài khoản chưa xác định hoặc webhook không đến không được tự đánh dấu là đã thanh toán. Sự kiện cần ở trạng thái rà soát; nhân viên đối chiếu với SePay/ngân hàng. Việc polling SePay để tự tìm lại webhook bị mất chưa được triển khai đầy đủ.", fill=PALE_GOLD)

heading("4.3 Xử lý đơn COD và giao hàng", 2)
for item in [
    "Kiểm tra trạng thái đơn, tồn được giữ, thông tin nhận hàng và số COD.",
    "Tạo vận đơn trong Quản lý giao hàng, chọn dịch vụ, phí và bên trả cước; lưu mã vận đơn.",
    "Theo dõi trạng thái hãng trả về. Khi giao thành công, chuyển sang bước đối chiếu tiền COD; không xem trạng thái giao hàng là bằng chứng hãng đã chuyển tiền.",
    "Tạo bảng kê COD theo sao kê hãng, ghi số dự kiến/đã nhận/phí. Chốt khi đã giải thích mọi chênh lệch; đảo bảng kê khi phát hiện sai theo quyền vận hành.",
]: numbered(item)

heading("4.4 Trả hàng và hoàn tiền", 2)
for item in [
    "Chỉ tạo yêu cầu trả cho đơn đủ điều kiện; chọn dòng hàng và số lượng không vượt số đã mua/chưa bị trả ở yêu cầu khác.",
    "Duyệt hoặc từ chối, xác nhận đã nhận hàng thực tế và quyết định rõ có nhập lại kho không.",
    "Ghi nhận hoàn tiền sau khi người có trách nhiệm thực hiện giao dịch hoàn qua kênh thanh toán; lưu chứng từ/nội dung nội bộ.",
]: numbered(item)
p("Phiếu hoàn trong GEME là bằng chứng kế toán/vận hành, không thay cho lệnh chuyển tiền của ngân hàng, SePay hoặc POS.", color=MUTED)

heading("4.5 Soạn và xuất bản nội dung", 2)
for item in [
    "Tạo Blog hoặc bài mạng xã hội riêng; nhập nội dung, ảnh và thông tin SEO/CTA phù hợp kênh.",
    "Với mạng xã hội, kết nối tài khoản trước, chọn đích đăng cụ thể và rà nội dung/giá/khuyến mãi; chỉnh sửa sau duyệt sẽ cần duyệt lại.",
    "Theo dõi kết quả theo từng kênh; nếu trạng thái chưa rõ, xác minh ở Meta trước khi gửi lại.",
]: numbered(item)

# Integrations and gaps
heading("5. Tích hợp và điều kiện vận hành", 1)
table(["Tích hợp", "GEME dùng để làm gì", "Điều kiện cần kiểm tra", "Giới hạn hiện biết"], [
    ("POS365", "Đồng bộ SKU, giá, tồn, ảnh và đơn/thanh toán theo hàng đợi.", "Tenant/username/password/branch; bật sync ghi đúng môi trường; URL ảnh công khai; tài khoản thanh toán POS nếu ghi nhận bank transfer.", "Kiểm tra kết nối đọc không đồng nghĩa ghi đã bật. Mỗi queue phải xem trạng thái kết quả."),
    ("SePay", "Lấy tài khoản ngân hàng hoạt động để tạo QR và xác nhận tiền đến qua webhook.", "API token server-side, đúng một tài khoản active, webhook HMAC secret, prefix GEME, URL callback HTTPS, bật webhook sau khi deploy.", "Số tiền phải khớp đủ; chưa có cơ chế polling tự khôi phục mọi webhook bị mất."),
    ("Viettel Post", "Tính cước, tạo vận đơn/nhãn và nhận trạng thái vận chuyển.", "Partner token, endpoint đúng môi trường, người gửi, webhook token và callback.", "Giao thành công không tự xác nhận tiền COD đã quyết toán."),
    ("Meta", "Đăng nội dung tới Facebook Page/Instagram Professional.", "Meta App ID/secret, phiên bản Graph, callback, khóa mã hóa token, Page và quyền App Review.", "Không xử lý inbox/bình luận/quảng cáo; kết quả UNKNOWN cần đối soát."),
    ("Shopee", "Đọc đơn marketplace và ghép SKU theo shop.", "Partner ID/Key đúng sandbox/production, callback, khóa mã hóa, app đã được cấp quyền và worker/Redis.", "Đơn Shopee hiện tách khỏi đơn GEME, tồn kho, POS, vận đơn và báo cáo doanh thu."),
    ("R2 / Media Worker", "Lưu ảnh/video và phục vụ ảnh công khai theo URL HTTPS.", "Bucket/key giới hạn quyền, Worker public media, MEDIA_PUBLIC_BASE_URL và cấu hình provider ở backend.", "Admin có thể mở upload nhưng ảnh không hiển thị nếu URL gateway/credential sai."),
    ("Aegis / SMTP", "OTP, khôi phục tài khoản khách và gửi thư giao dịch.", "API URL/key nội bộ, SMTP host/port/username/app password/from và SSL.", "API có thể ghi nhận đã xếp thư nhưng không đồng nghĩa email đã vào hộp thư."),
], [1.0, 1.5, 2.55, 1.55], font_size=7.8)
p("Nguyên tắc cấu hình: kiểm thử trên test trước; giữ secret ở secret store/.env backend; xác nhận đúng domain, database, tenant/branch và tài khoản nhận; sau đó kiểm tra log/queue và thực hiện giao dịch nhỏ có đối soát. Không copy credentials production vào staging.")

doc.add_page_break()
heading("6. Trạng thái triển khai và nội dung cần theo dõi", 1)
p("Bảng dưới đây tóm tắt trạng thái có thể kết luận từ mã nguồn và tài liệu vận hành đối chiếu ngày 01/11/2026. Trạng thái kết nối thật cần kiểm tra trực tiếp trong từng môi trường, vì local, test và production dùng env/database/tài khoản nhà cung cấp riêng.")
table(["Nhóm", "Đánh giá hiện tại", "Việc quản lý cần biết"], [
    ("Admin cơ bản", "Có trong ứng dụng", "Đơn, sản phẩm, kho, giá, khách, khuyến mãi, blog, báo cáo, cài đặt và phân quyền là các module hiện hành."),
    ("Thông báo", "Có trong ứng dụng", "Chuông đọc thông báo đã ghi bởi API, đánh dấu đã đọc; không phải push realtime khi người dùng offline."),
    ("SePay QR", "Có luồng xác nhận và kiểm tra số tiền", "Phải giữ webhook/API token đúng. Nếu webhook thất lạc, hiện cần đối chiếu thủ công; polling giao dịch để khôi phục tự động chưa hoàn tất."),
    ("POS365", "Có luồng queue/sync", "Kiểm tra cấu hình và trạng thái ghi của đúng môi trường; phải rà lỗi từng dòng, không chỉ thấy nút đồng bộ."),
    ("Hoàn tiền", "Ghi nhận nội bộ", "Nhân viên vẫn cần thao tác hoàn tiền thực tế qua ngân hàng/nhà cung cấp."),
    ("COD", "Có bảng kê và đối soát", "Chênh lệch phải được lưu giải thích; hãng giao thành công chưa chứng minh đã chuyển tiền COD."),
    ("Mạng xã hội", "Có workflow soạn/duyệt/lịch", "Meta App, tài khoản đích và quyền xuất bản có thể cần xác minh/duyệt thêm."),
    ("Shopee", "Có màn hình/worker; phụ thuộc App", "Sản phẩm đang ở luồng đơn riêng, không tự nhập sổ đơn bán chính GEME."),
    ("Nguồn khách hàng", "Có báo cáo nhưng dữ liệu nguồn có thể thiếu", "Cần quyết định cách ghi nguồn ở checkout/đơn hàng để thống kê chính xác."),
    ("AI Studio", "Không nằm trong Admin hiện hành", "Quy trình tạo nội dung/ảnh hiện do nhân viên thao tác thủ công."),
], [1.35, 1.6, 3.65], font_size=8.1)

heading("7. Hướng dẫn kiểm tra nhanh cho quản lý", 1)
heading("Mỗi ngày", 2)
for item in [
    "Mở Tổng quan và Thông báo; xem đơn mới/chưa đọc.",
    "Đơn chờ thanh toán: kiểm tra hạn QR và trạng thái SePay; không xác nhận thủ công khi chưa có bằng chứng tiền đến.",
    "Đơn Chờ xác nhận: kiểm tra thanh toán đủ, SKU/biến thể, ảnh, số lượng và trạng thái POS.",
    "Đơn đang giao/đã giao: kiểm tra mã vận đơn và các khoản COD cần đối soát.",
    "Kiểm tra cảnh báo tồn thấp và phiếu nhập đang chờ đồng bộ.",
]: bullet(item)
heading("Mỗi tuần", 2)
for item in [
    "Rà sản phẩm nháp/ẩn/hết ảnh hoặc thiếu trường cần đăng; so khớp SKU với kho và hồ sơ giá.",
    "Đối chiếu phiếu nhập và queue POS365; rà lỗi ảnh/giá/tồn theo SKU.",
    "Rà khuyến mãi sắp hết hạn, Blog/lịch mạng xã hội và các bài có kết quả chưa rõ.",
    "Kiểm tra tài khoản nhân viên, phạm vi trang và quyền nhạy cảm.",
]: bullet(item)

heading("Trước khi triển khai lên host chính", 2)
for item in [
    "Sao lưu cơ sở dữ liệu và media; ghi lại release đang chạy và giữ image/source để rollback.",
    "Xác nhận SSL, DNS, domain API, CORS, Redis, database, media Worker, SMTP/Aegis và thời gian NTP.",
    "Dùng secret riêng cho production; kiểm tra quyền POS/SePay/Viettel Post/Meta/Shopee đúng tài khoản, chi nhánh và môi trường.",
    "Áp dụng migration theo quy trình release, kiểm tra health/readiness, queue, log, ảnh trên card/chi tiết và thao tác trên điện thoại.",
    "Chạy thử luồng đơn nội bộ: tạo đơn → thanh toán/đối soát → tạo vận đơn → cập nhật giao → kiểm kê; không dùng lệnh seed/reset trên dữ liệu thật.",
]: numbered(item)

heading("Ghi nhận phiên bản đối chiếu", 1)
p("Báo cáo được lập từ cây mã Admin, API, tài liệu vận hành và ghi chú triển khai GEME hiện có tại ngày 01/11/2026. Ghi chú vận hành ghi nhận bộ lọc “Đơn đã hủy” đã được cập nhật lên Admin staging và local ngày 01/11/2026. Việc một tích hợp đang hoạt động trên staging/production phải được xác nhận lại trong Cài đặt, trạng thái worker và dashboard của nhà cung cấp trước khi dùng cho giao dịch thật.")
p("Tài liệu nội bộ dùng để báo cáo phạm vi và hướng dẫn người vận hành; không thay thế quy trình đào tạo, phê duyệt nghiệp vụ tài chính hoặc kiểm thử bảo mật độc lập.", color=MUTED)

# Core document metadata and final polish.
doc.core_properties.title = "Báo cáo chức năng GEME Admin"
doc.core_properties.subject = "Phạm vi, công dụng, hướng dẫn sử dụng và trạng thái vận hành Admin GEME"
doc.core_properties.author = "GEME"
doc.core_properties.keywords = "GEME, Admin, báo cáo, vận hành"
doc.save(OUT)
print(OUT)
