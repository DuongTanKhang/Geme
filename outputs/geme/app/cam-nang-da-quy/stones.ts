export type GuideStone = {
  slug: string;
  name: string;
  image?: string;
  tone: "opal" | "moonstone" | "blue" | "green" | "pink" | "quartz" | "red" | "jade" | "pearl" | "purple" | "gold" | "garnet" | "sapphire";
  subtitle: string;
  summary: string;
  headline: string;
  intro: string;
  story: string[];
  signature: string;
  colors: string;
  care: string;
  sourceUrl: string;
};

export const guideStones: GuideStone[] = [
  {
    slug: "opal", name: "Opal", image: "/assets/gemstone-opal.png", tone: "opal",
    subtitle: "Sắc màu luôn chuyển động", summary: "Sắc màu huyền ảo, độc đáo và đầy cảm xúc.",
    headline: "Một dải màu riêng trong từng góc nhìn",
    intro: "Opal được yêu thích bởi những mảng màu có thể đổi sắc khi viên đá nghiêng dưới ánh sáng. Hiệu ứng ấy khiến mỗi viên mang một bố cục màu sắc riêng.",
    story: ["Trong cấu trúc opal quý, những hạt silica xếp theo trật tự có thể tán sắc ánh sáng thành các mảng màu rực rỡ. Người chơi đá thường gọi hiện tượng này là “play-of-color”.", "Opal có nhiều dáng vẻ: nền trắng sáng, nền tối sâu hay nền trong như pha lê. Khi chọn đá, hãy quan sát độ sáng, cách màu phân bố và tổng thể viên đá trong ánh sáng tự nhiên."],
    signature: "Hiệu ứng chơi màu trên nền đá", colors: "Trắng, kem, xám, đen cùng ánh xanh, cam, hồng",
    care: "Opal tương đối mềm và nhạy với va đập, nhiệt độ thay đổi nhanh. Lau nhẹ bằng khăn mềm; tránh máy rung siêu âm và chất tẩy mạnh.",
    sourceUrl: "https://www.gia.edu/opal",
  },
  {
    slug: "moonstone", name: "Moonstone", image: "/assets/gemstone-moonstone.png", tone: "moonstone",
    subtitle: "Ánh sáng dịu như trăng", summary: "Ánh trăng dịu dàng, thanh khiết và nữ tính.",
    headline: "Vệt sáng mềm nằm dưới bề mặt đá", intro: "Moonstone là một thành viên của họ feldspar, nổi bật bởi ánh sáng mềm như làn sương lướt bên dưới bề mặt viên đá.",
    story: ["Hiệu ứng ánh xanh hoặc trắng thường hiện rõ hơn khi viên đá được mài dạng cabochon và xoay dưới nguồn sáng. Mỗi viên có độ trong, sắc nền và vệt sáng khác nhau.", "Moonstone hợp với thiết kế có bề mặt cong, nơi ánh sáng có thể di chuyển theo chuyển động của người đeo. Vẻ đẹp của đá thường nằm ở sự dịu nhẹ, không cần quá nhiều chi tiết đi kèm."],
    signature: "Ánh quang mềm (adularescence)", colors: "Trắng sữa, kem, xám hoặc ánh xanh", care: "Đá có thể sứt mẻ khi va đập mạnh. Cất riêng, tránh va chạm và vệ sinh nhẹ bằng nước ấm pha xà phòng dịu.",
    sourceUrl: "https://www.gia.edu/moonstone/buyers-guide",
  },
  {
    slug: "aquamarine", name: "Aquamarine", image: "/assets/gemstone-aquamarine.png", tone: "blue",
    subtitle: "Sắc xanh của biển", summary: "Biểu tượng của sự bình yên và mát lành.",
    headline: "Sắc xanh trong trẻo của họ Beryl", intro: "Aquamarine là biến thể beryl mang sắc xanh đến xanh lục lam, thường gợi cảm giác trong trẻo và thanh lịch.",
    story: ["Tên gọi aquamarine bắt nguồn từ hình ảnh màu nước biển. Màu đá trải từ xanh rất nhạt đến xanh lam đậm hơn; sắc độ và độ trong tạo nên khác biệt giữa từng viên.", "Trong trang sức, aquamarine thường được mài mặt để tôn độ sáng hoặc mài cabochon cho vẻ mềm mại. Một đường cắt cân đối giúp ánh sáng đi qua viên đá đẹp hơn."],
    signature: "Khoáng vật thuộc nhóm beryl", colors: "Xanh nhạt, xanh biển đến xanh lục lam", care: "Có thể vệ sinh bằng nước ấm, xà phòng dịu và bàn chải mềm. Tránh thay đổi nhiệt độ đột ngột và hóa chất tẩy rửa.",
    sourceUrl: "https://www.gia.edu/aquamarine/buyers-guide",
  },
  {
    slug: "peridot", name: "Peridot", image: "/assets/gemstone-peridot.png", tone: "green",
    subtitle: "Sắc lục tươi sáng", summary: "Tông xanh vàng tươi sáng, dễ nhận biết.",
    headline: "Màu xanh đến từ chính cấu trúc khoáng vật", intro: "Peridot là tên dùng cho olivine có chất lượng đá quý. Màu xanh lục đặc trưng của đá đến từ thành phần sắt bên trong tinh thể.",
    story: ["Khác với nhiều loại đá quý có màu do tạp chất vi lượng, peridot mang sắc xanh vốn có trong thành phần khoáng vật. Sắc đá có thể nghiêng vàng lục hoặc xanh lục thuần.", "Peridot thường được mài thành mặt cắt để làm nổi bật độ lấp lánh. Sắc xanh tươi của đá tạo điểm nhấn hài hòa trên nền vàng, bạc hoặc vàng trắng."],
    signature: "Khoáng vật olivine", colors: "Xanh vàng đến xanh lục", care: "Độ cứng vừa phải nên nên tránh va đập và cất riêng với đá cứng hơn. Làm sạch bằng nước ấm, xà phòng dịu.",
    sourceUrl: "https://www.gia.edu/peridot/buyers-guide",
  },
  {
    slug: "tourmaline", name: "Tourmaline", image: "/assets/gemstone-tourmaline.png", tone: "pink",
    subtitle: "Một họ đá, nhiều sắc độ", summary: "Đa sắc, nổi bật với nhiều biến thể.",
    headline: "Bảng màu phong phú của họ Tourmaline", intro: "Tourmaline là một nhóm khoáng vật có dải màu rộng. Tên gọi chung ấy bao gồm nhiều sắc độ và đặc điểm khác nhau.",
    story: ["Từ xanh lục, xanh lam đến hồng và đỏ, tourmaline có thể xuất hiện trong một màu hoặc nhiều dải màu trên cùng tinh thể. Một số viên có vùng màu phân lớp rất rõ.", "Khi chọn tourmaline, nên xem viên đá dưới ánh sáng trung tính và quan sát cách màu phân bố. Vết bao thể tự nhiên cũng có thể xuất hiện; độ trong phù hợp tùy theo từng kiểu cắt và thiết kế."],
    signature: "Nhóm khoáng vật có nhiều biến thể", colors: "Hồng, đỏ, xanh, lục, vàng và nhiều màu phối hợp", care: "Dùng nước ấm, xà phòng dịu và khăn mềm. Tránh nhiệt cao, thay đổi nhiệt đột ngột và chất tẩy mạnh.",
    sourceUrl: "https://www.gia.edu/tourmaline/buyers-guide",
  },
  {
    slug: "thach-anh", name: "Thạch anh", image: "/assets/gemstone-quartz.png", tone: "quartz",
    subtitle: "Vẻ đẹp từ tinh thể tự nhiên", summary: "Trong trẻo, đa dạng về dạng tinh thể.",
    headline: "Một họ khoáng vật quen thuộc và đa dạng", intro: "Thạch anh là một trong những khoáng vật phổ biến nhất trong trang sức. Từ dạng trong suốt đến nhiều biến thể có màu, mỗi loại mang một diện mạo riêng.",
    story: ["Thạch anh có thể hình thành tinh thể lớn, cấu trúc hạt mịn hoặc dạng vi tinh thể. Màu sắc và độ trong phụ thuộc vào biến thể, điều kiện hình thành và các yếu tố vi lượng.", "Trong thiết kế, thạch anh trong thường tạo cảm giác nhẹ nhàng, còn các dạng có màu hoặc vân tự nhiên giúp bề mặt trang sức có thêm chiều sâu."],
    signature: "Silicon dioxide (SiO₂)", colors: "Trong, trắng sữa, xám và nhiều sắc màu theo biến thể", care: "Đa số thạch anh có thể làm sạch bằng nước ấm và xà phòng dịu. Tránh va đập mạnh và cất riêng để hạn chế trầy xước.",
    sourceUrl: "https://www.gia.edu/gem-encyclopedia",
  },
  {
    slug: "ruby", name: "Ruby", image: "/assets/gemstone-ruby.png", tone: "red",
    subtitle: "Sắc đỏ giàu chiều sâu", summary: "Sắc đỏ cổ điển với độ sâu cuốn hút.",
    headline: "Viên corundum đỏ đầy cuốn hút", intro: "Ruby là tên gọi dành cho corundum có sắc đỏ. Cường độ màu, độ trong và chất lượng mài cắt cùng tạo nên vẻ đẹp của từng viên.",
    story: ["Sắc đỏ của ruby có thể trải từ đỏ hồng đến đỏ đậm. Các bao thể tự nhiên khá phổ biến; chúng là một phần đặc điểm nhận diện và không tự động đồng nghĩa với chất lượng kém.", "Ruby được dùng trong nhẫn, mặt dây và nhiều món trang sức cần điểm nhấn rõ nét. Với đá có xử lý, thông tin xử lý nên được công bố minh bạch khi mua bán."],
    signature: "Corundum màu đỏ", colors: "Đỏ hồng đến đỏ đậm", care: "Với ruby chưa qua xử lý hoặc đã xử lý nhiệt, nước ấm pha xà phòng thường phù hợp. Nếu không rõ xử lý bề mặt, hãy hỏi đơn vị bán trước khi vệ sinh.",
    sourceUrl: "https://www.gia.edu/ruby/buyers-guide",
  },
  {
    slug: "ngoc-bich", name: "Ngọc bích", image: "/assets/gemstone-jadeite.png", tone: "jade",
    subtitle: "Sắc xanh gắn với thủ công", summary: "Loại đá lâu đời trong nghệ thuật chạm khắc.",
    headline: "Tên gọi bao quát hai loại đá khác nhau", intro: "Ngọc bích thường chỉ jadeite hoặc nephrite. Cả hai đều có lịch sử lâu đời trong nghệ thuật chạm khắc và trang sức châu Á.",
    story: ["Jadeite và nephrite khác nhau về thành phần khoáng vật, cấu trúc và một số đặc tính. Màu xanh được biết đến nhiều, nhưng ngọc còn có thể có sắc trắng, vàng, nâu, tím hoặc đen.", "Độ trong, kết cấu, màu sắc, cách xử lý và tay nghề chế tác đều ảnh hưởng đến vẻ đẹp và giá trị. Khi mua ngọc, nên ưu tiên thông tin phân loại và xử lý rõ ràng."],
    signature: "Jadeite hoặc nephrite", colors: "Xanh, trắng, vàng, nâu, tím và nhiều sắc độ khác", care: "Tránh hóa chất mạnh, va đập và thay đổi nhiệt độ nhanh. Lau bằng khăn mềm hơi ẩm; hỏi chuyên gia nếu món ngọc có lớp phủ hoặc xử lý đặc biệt.",
    sourceUrl: "https://www.gia.edu/jade-care-cleaning",
  },
  {
    slug: "ngoc-trai", name: "Ngọc trai", image: "/assets/gemstone-pearl.png", tone: "pearl",
    subtitle: "Ánh xà cừ tự nhiên", summary: "Vẻ đẹp thuần khiết từ đại dương.",
    headline: "Ánh xà cừ hình thành qua từng lớp", intro: "Ngọc trai là vật liệu hữu cơ quý được tạo nên trong thân loài nhuyễn thể. Những lớp xà cừ tạo ra ánh bóng mềm rất riêng.",
    story: ["Ngọc trai có thể hình thành tự nhiên hoặc được nuôi cấy. Hình dáng, độ bóng, bề mặt, kích thước và màu nền là những yếu tố thường được xem xét khi đánh giá.", "Vẻ đẹp của ngọc trai hợp với thiết kế thanh lịch và chất liệu kim loại sáng. Vì bề mặt nhạy hơn nhiều loại đá quý, cách sử dụng và bảo quản nhẹ nhàng rất quan trọng."],
    signature: "Vật liệu hữu cơ phủ lớp xà cừ", colors: "Trắng, kem, hồng, vàng, xám và đen", care: "Đeo sau khi dùng mỹ phẩm, nước hoa và keo xịt tóc. Sau khi sử dụng, lau nhẹ bằng khăn mềm; tránh ngâm hóa chất hoặc dùng máy siêu âm.",
    sourceUrl: "https://www.gia.edu/pearl/buyers-guide",
  },
  {
    slug: "thach-anh-tim", name: "Thạch anh tím", image: "/assets/guide-amethyst.png", tone: "purple",
    subtitle: "Biến thể tím của thạch anh", summary: "Thanh lịch, trầm ấm và dễ kết hợp.",
    headline: "Sắc tím đặc trưng của Amethyst", intro: "Amethyst, hay thạch anh tím, là một biến thể của thạch anh. Sắc tím có thể nhạt như khói hoặc sâu và đậm hơn.",
    story: ["Màu tím trong amethyst liên quan đến các yếu tố vi lượng và tác động tự nhiên trong quá trình hình thành. Sắc màu có thể không đồng nhất hoàn toàn giữa các vùng trong viên đá.", "Amethyst được chế tác thành nhiều kiểu dáng, từ mặt cắt hình học đến chuỗi hạt. Khi chọn đá, nên xem màu dưới ánh sáng tự nhiên và tìm hiểu xem viên đá có được xử lý hay không."],
    signature: "Thạch anh màu tím", colors: "Tím lavender đến tím đậm", care: "Làm sạch bằng nước ấm, xà phòng dịu và khăn mềm. Hạn chế phơi lâu dưới nắng gắt hoặc để gần nguồn nhiệt để màu đá ổn định hơn.",
    sourceUrl: "https://www.gia.edu/amethyst/buyers-guide",
  },
  {
    slug: "thach-anh-vang", name: "Thạch anh vàng", image: "/assets/guide-citrine.png", tone: "gold",
    subtitle: "Biến thể vàng của thạch anh", summary: "Sắc vàng trong trẻo, nhẹ nhàng và rạng rỡ.",
    headline: "Sắc vàng tự nhiên của Citrine", intro: "Thạch anh vàng, thường gọi là citrine, là biến thể thạch anh có sắc vàng đến vàng cam. Màu sắc có thể từ nhạt trong đến tông mật ong ấm.",
    story: ["Citrine tự nhiên khá hiếm trên thị trường trang sức; nhiều viên citrine thương mại được tạo màu bằng xử lý nhiệt từ amethyst hoặc thạch anh khói. Việc công bố xử lý giúp người mua hiểu đúng về viên đá.", "Sắc vàng của citrine phối hợp đẹp với vàng vàng và các thiết kế tối giản. Tông màu sáng cũng tạo điểm nhấn ấm mà không quá rực."],
    signature: "Thạch anh màu vàng", colors: "Vàng nhạt đến vàng cam", care: "Dùng nước ấm, xà phòng dịu và khăn mềm. Tránh nhiệt độ cao hoặc thay đổi nhiệt nhanh; hỏi về xử lý nếu cần dùng phương pháp vệ sinh chuyên dụng.",
    sourceUrl: "https://www.gia.edu/citrine/buyers-guide",
  },
  {
    slug: "garnet", name: "Garnet", image: "/assets/guide-garnet.png", tone: "garnet",
    subtitle: "Sắc đỏ rượu vang", summary: "Tông màu sâu, cổ điển và có chiều sâu.",
    headline: "Một nhóm đá với nhiều sắc màu", intro: "Garnet là tên của một nhóm khoáng vật, không chỉ một loại đá đơn lẻ. Màu đỏ sẫm rất quen thuộc, nhưng nhóm này còn có những sắc xanh, cam, lục và vàng.",
    story: ["Các thành viên của nhóm garnet có thành phần và đặc tính riêng. Vì vậy, chỉ nhìn màu chưa đủ để xác định chính xác loại garnet; việc kiểm định cần dựa trên các đặc điểm gemology.", "Trong trang sức, tông đỏ nâu hoặc đỏ rượu vang đem lại vẻ cổ điển. Các dạng màu sáng hơn cũng có thể tạo cảm giác hiện đại khi được mài cắt phù hợp."],
    signature: "Nhóm khoáng vật garnet", colors: "Đỏ, cam, vàng, lục và một số sắc xanh", care: "Nước ấm pha xà phòng dịu và bàn chải mềm thường phù hợp. Cất riêng, tránh va đập và kiểm tra chấu định kỳ với món trang sức đeo thường xuyên.",
    sourceUrl: "https://www.gia.edu/gem-encyclopedia",
  },
  {
    slug: "sapphire", name: "Sapphire", image: "/assets/guide-sapphire.png", tone: "sapphire",
    subtitle: "Sắc xanh sâu và thanh lịch", summary: "Vẻ đẹp bền bỉ với nhiều màu sắc khác nhau.",
    headline: "Corundum có thể mang nhiều màu", intro: "Sapphire là corundum có chất lượng đá quý, thường gợi đến màu xanh lam nhưng thực tế có nhiều màu khác nhau.",
    story: ["Sapphire có thể xuất hiện ở màu hồng, vàng, xanh lục, tím và không màu. Corundum màu đỏ được gọi bằng tên ruby; các màu khác thường được gọi là sapphire màu.", "Độ sâu của màu, độ trong và cách mài cắt làm thay đổi diện mạo viên đá. Với sapphire, thông tin về xử lý nhiệt hoặc khuếch tán nên được trao đổi rõ khi lựa chọn."],
    signature: "Corundum khác màu đỏ", colors: "Xanh lam và nhiều màu khác", care: "Sapphire có độ cứng cao nhưng vẫn có thể nứt hoặc sứt khi va đập. Vệ sinh với nước ấm, xà phòng dịu; lưu ý nếu viên đá có xử lý hoặc vết nứt.",
    sourceUrl: "https://www.gia.edu/sapphire/buyers-guide",
  },
];

export const getGuideStone = (slug: string) => guideStones.find((stone) => stone.slug === slug);
