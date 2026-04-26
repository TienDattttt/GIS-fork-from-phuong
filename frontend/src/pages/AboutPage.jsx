import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Github,
  Globe2,
  Linkedin,
  MoonStar,
  Rocket,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Workflow,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import "../styles/about.css";

const stats = [
  { value: 34, suffix: "+", label: "tỉnh thành đã sẵn sàng cho phân tích theo ranh giới hành chính" },
  { value: 12, suffix: "+", label: "lớp dữ liệu khí hậu và môi trường đang vận hành trong nền tảng" },
  { value: 4800, suffix: "+", label: "phiên phân tích mỗi tháng từ nhóm nghiên cứu và người dùng thử nghiệm" },
  { value: 98.7, suffix: "%", label: "độ ổn định trung bình của luồng đồng bộ và phân tích dữ liệu" },
];

const timeline = [
  {
    year: "2024",
    title: "Khởi đầu từ một đồ án WebGIS",
    description:
      "Do An GIS bắt đầu như một dự án xây dựng bản đồ phân tích mưa, nhiệt độ, NDVI, độ ẩm đất và TVDI cho cấp tỉnh. Mục tiêu ban đầu rất rõ ràng: biến dữ liệu môi trường rời rạc thành một không gian quan sát trực quan hơn.",
  },
  {
    year: "Đầu 2025",
    title: "Kết nối Google Earth Engine",
    description:
      "Chúng tôi bổ sung khả năng lấy dữ liệu trực tiếp từ Earth Engine, đồng bộ về PostgreSQL và phân tích theo geometry tùy chọn. Từ đây, sản phẩm vượt khỏi phạm vi trình diễn để tiến gần hơn tới một công cụ phân tích thật sự.",
  },
  {
    year: "Cuối 2025",
    title: "Map-first workflow",
    description:
      "Ranh giới hành chính, geocoding, routing và lịch sử vùng phân tích được đưa vào ứng dụng. Người dùng có thể tìm kiếm, zoom, vẽ vùng, so sánh và mở thẳng các mô-đun phân tích ngay từ bản đồ.",
  },
  {
    year: "2026",
    title: "Mở rộng sang vận hành thực địa",
    description:
      "Trang trạm quan trắc, nhập liệu thủ công, tính mưa bằng IDW và các lớp chuyên đề được bổ sung để nền tảng hỗ trợ cả nhu cầu trực quan hóa lẫn thu thập và đối chiếu dữ liệu tại hiện trường.",
  },
];

const values = [
  {
    icon: ShieldCheck,
    title: "Ưu tiên tính kiểm chứng",
    description: "Mỗi chỉ số và lớp bản đồ đều phải truy ngược được về nguồn dữ liệu và cách tính.",
  },
  {
    icon: ScanSearch,
    title: "Bắt đầu từ bản đồ",
    description: "Chúng tôi xem không gian là ngữ cảnh gốc, còn biểu đồ là lớp giải thích tiếp theo.",
  },
  {
    icon: Workflow,
    title: "Phục vụ vận hành thật",
    description: "Tính năng chỉ có ý nghĩa khi giúp người dùng ra quyết định nhanh và rõ hơn.",
  },
  {
    icon: Sparkles,
    title: "Đơn giản hóa cái phức tạp",
    description: "Phân tích khí hậu vốn phức tạp, nhưng trải nghiệm sử dụng không nên như vậy.",
  },
  {
    icon: Globe2,
    title: "Tôn trọng bối cảnh địa phương",
    description: "Ranh giới hành chính, thực địa và đặc trưng vùng miền luôn là một phần của thiết kế.",
  },
  {
    icon: Rocket,
    title: "Làm nhanh nhưng không cẩu thả",
    description: "Chúng tôi thích tiến nhanh bằng các vòng lặp nhỏ, có phản hồi và có kiểm soát chất lượng.",
  },
];

const team = [
  {
    initials: "QP",
    name: "Quang Phương",
    title: "Phụ trách sản phẩm & GIS",
    bio: "Quang Phương định hình luồng phân tích chính của Do An GIS, từ bài toán WebGIS, ranh giới hành chính đến cách người dùng tương tác và ra quyết định trực tiếp trên bản đồ.",
    linkedin: "https://www.linkedin.com/company/do-an-gis/",
    secondaryHref: "https://github.com/",
    secondaryKind: "github",
  },
  {
    initials: "NL",
    name: "Nhi Lê",
    title: "Kỹ sư nền tảng dữ liệu & giao diện",
    bio: "Nhi Lê phụ trách triển khai backend, đồng bộ dữ liệu, tích hợp Earth Engine và hoàn thiện giao diện để hệ thống vừa mạnh về kỹ thuật vừa dễ sử dụng trong thực tế.",
    linkedin: "https://www.linkedin.com/company/do-an-gis/",
    secondaryHref: "https://github.com/",
    secondaryKind: "github",
  },
];

const partners = ["Google Earth Engine", "OpenStreetMap", "PostgreSQL", "Django REST", "Leaflet", "Nominatim"];

function AnimatedStat({ value, suffix, label }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const duration = 1600;
          const start = performance.now();

          const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const nextValue = value % 1 === 0 ? Math.round(value * eased) : Number((value * eased).toFixed(1));
            setDisplay(nextValue);
            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              setDisplay(value);
            }
          };

          requestAnimationFrame(step);
          observer.disconnect();
        });
      },
      { threshold: 0.45 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="about-stat-card" ref={ref}>
      <strong>
        {display}
        {suffix}
      </strong>
      <span>{label}</span>
    </div>
  );
}

export default function AboutPage() {
  const { logActivity } = useAuth();
  const rootRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("do-an-gis-about-theme") || "light");

  useEffect(() => {
    void logActivity("page_view", "about");
  }, [logActivity]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );

    root.querySelectorAll("[data-about-reveal]").forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem("do-an-gis-about-theme", theme);
  }, [theme]);

  const navItems = useMemo(
    () => [
      { href: "#about-mission", label: "Sứ mệnh" },
      { href: "#about-story", label: "Hành trình" },
      { href: "#about-team", label: "Đội ngũ" },
      { href: "#about-values", label: "Giá trị" },
      { href: "#about-careers", label: "Tuyển dụng" },
    ],
    []
  );

  return (
    <div className="about-page" data-theme={theme} ref={rootRef}>
      <section className="about-hero">
        <div className="about-shell">
          <div className="about-hero-grid" id="about-top">
            <div className="about-hero-copy" data-about-reveal>
              <h1>Chúng tôi xây dựng những sản phẩm không gian giúp dữ liệu khí hậu trở thành quyết định rõ ràng.</h1>
              <p>
                Do An GIS phát triển nền tảng phân tích khí hậu và môi trường theo hướng bản đồ, nơi người dùng có thể
                tìm kiếm, vẽ vùng, quan sát lớp chuyên đề và phân tích dữ liệu trong cùng một không gian trực quan.
              </p>
              <div className="about-hero-actions">
                <a href="#about-mission" className="about-button">
                  Khám phá sứ mệnh <ArrowRight size={18} />
                </a>
                <a href="#about-story" className="about-ghost-button">
                  Xem hành trình phát triển
                </a>
                <button
                  type="button"
                  className="about-icon-button"
                  onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                  aria-label="Đổi giao diện sáng tối"
                >
                  {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
                </button>
              </div>
            </div>

            <aside className="about-hero-card" data-about-reveal>
              <div className="about-hero-badge">
                <strong>Slogan</strong>
                <span>Biến dữ liệu không gian thành quyết định khí hậu.</span>
              </div>
              <div className="about-hero-badge">
                <strong>Lĩnh vực</strong>
                <span>Nền tảng WebGIS, phân tích khí hậu và hỗ trợ ra quyết định môi trường.</span>
              </div>
              <div className="about-hero-badge">
                <strong>Lý do tồn tại</strong>
                <span>
                  Chúng tôi tin rằng dữ liệu môi trường sẽ có giá trị lớn hơn nhiều khi được đặt đúng lên bản đồ, đúng
                  theo bối cảnh địa phương và đúng nhịp công việc của người dùng.
                </span>
              </div>
            </aside>
          </div>

          <div className="about-section-nav" data-about-reveal>
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="about-section-link">
                {item.label}
              </a>
            ))}
            <a href="#about-careers" className="about-section-link about-section-link--accent">
              Tham gia cùng chúng tôi
            </a>
          </div>
        </div>
      </section>

      <section className="about-section about-anchor" id="about-mission">
        <div className="about-shell about-mission-grid">
          <div data-about-reveal>
            <span className="about-eyebrow">Sứ mệnh</span>
            <blockquote className="about-mission-quote">
              “Chúng tôi muốn dữ liệu khí hậu và môi trường đi vào luồng ra quyết định hằng ngày, chứ không chỉ nằm
              trong các báo cáo tổng kết.”
            </blockquote>
          </div>
          <div className="about-copy" data-about-reveal>
            <p>
              Do An GIS ra đời để giải quyết một khoảng trống rất cụ thể: nhiều nhóm nghiên cứu, quản lý hoặc vận hành
              hiện trường biết rằng họ cần phân tích không gian, nhưng các công cụ họ có lại phân tán, khó sử dụng hoặc
              thiếu khả năng liên kết dữ liệu khí hậu theo ngữ cảnh địa lý.
            </p>
            <p>
              Sứ mệnh của chúng tôi là xây dựng một nền tảng mà ở đó bản đồ, dữ liệu và hành động nối với nhau một
              cách mạch lạc. Người dùng không phải chuyển qua lại giữa quá nhiều hệ thống chỉ để trả lời một câu hỏi:
              chuyện gì đang xảy ra tại khu vực này và tôi nên làm gì tiếp theo.
            </p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <div className="about-shell">
          <div className="about-stats-bar" data-about-reveal>
            {stats.map((item) => (
              <AnimatedStat key={item.label} {...item} />
            ))}
          </div>
        </div>
      </section>

      <section className="about-section about-anchor" id="about-story">
        <div className="about-shell">
          <div className="about-section-head" data-about-reveal>
            <span className="about-eyebrow">Hành trình phát triển</span>
            <h2>Từ một đồ án học thuật đến một nền tảng WebGIS có thể phục vụ bài toán thực tế.</h2>
            <p>
              Chúng tôi phát triển theo cách các đội sản phẩm tốt vẫn làm: bắt đầu với một luồng thật sự hữu ích, kiểm
              chứng trong thực tế, rồi mở rộng dần cho đến khi hệ thống đủ đáng tin để hỗ trợ vận hành.
            </p>
          </div>

          <div className="about-timeline">
            {timeline.map((item, index) => (
              <div key={item.year} className="about-timeline-item" data-about-reveal>
                <div className={`about-timeline-year ${index % 2 === 1 ? "reverse" : ""}`}>{item.year}</div>
                <article className="about-timeline-card">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section about-anchor" id="about-values">
        <div className="about-shell">
          <div className="about-section-head" data-about-reveal>
            <span className="about-eyebrow">Nguyên tắc làm việc</span>
            <h2>Chúng tôi ưu tiên sự rõ ràng, khả năng kiểm chứng và tính ứng dụng trong từng quyết định thiết kế.</h2>
          </div>

          <div className="about-values-grid">
            {values.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="about-value-card" data-about-reveal>
                  <div className="about-value-icon">
                    <Icon size={22} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="about-section about-anchor" id="about-team">
        <div className="about-shell">
          <div className="about-section-head" data-about-reveal>
            <span className="about-eyebrow">Về chúng tôi · Đội ngũ</span>
            <h2>Một nhóm làm việc ở giao điểm giữa GIS, dữ liệu khí hậu và thiết kế sản phẩm.</h2>
            <p>
              Đội ngũ hiện tại tập trung gọn vào hai vai trò cốt lõi: tư duy sản phẩm WebGIS và triển khai kỹ thuật.
              Chính sự tập trung này giúp Do An GIS giữ được nhịp phát triển nhanh nhưng vẫn bám sát bài toán thực tế.
            </p>
          </div>

          <div className="about-team-grid">
            {team.map((member) => (
              <article key={member.name} className="about-team-card" data-about-reveal>
                <div className="about-team-avatar">{member.initials}</div>
                <span className="about-team-role">{member.title}</span>
                <h3>{member.name}</h3>
                <p>{member.bio}</p>
                <div className="about-team-socials">
                  <a href={member.linkedin} target="_blank" rel="noreferrer" className="about-social-link" aria-label={`${member.name} trên LinkedIn`}>
                    <Linkedin size={18} />
                  </a>
                  <a
                    href={member.secondaryHref}
                    target="_blank"
                    rel="noreferrer"
                    className="about-social-link"
                    aria-label={`${member.name} trên hồ sơ chuyên môn`}
                  >
                    {member.secondaryKind === "github" ? <Github size={18} /> : <Globe2 size={18} />}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section">
        <div className="about-shell">
          <div className="about-section-head" data-about-reveal>
            <span className="about-eyebrow">Đối tác và hệ sinh thái</span>
            <h2>Chúng tôi xây dựng trên những công nghệ và nguồn dữ liệu giúp phân tích không gian trở nên khả thi.</h2>
          </div>

          <div className="about-partner-grid">
            {partners.map((partner) => (
              <div key={partner} className="about-partner-chip" data-about-reveal>
                {partner}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section about-anchor" id="about-careers">
        <div className="about-shell">
          <div className="about-cta-banner" data-about-reveal>
            <div className="about-cta-copy">
              <span className="about-eyebrow about-eyebrow-invert">Tuyển dụng</span>
              <h2>Hãy cùng chúng tôi xây dựng những công cụ bản đồ giúp quyết định môi trường trở nên tốt hơn.</h2>
              <p>
                Nếu bạn quan tâm đến GIS, dữ liệu khí hậu, thiết kế hệ thống hoặc trải nghiệm sản phẩm dựa trên bản đồ,
                đây là lúc phù hợp để cùng Do An GIS đi tiếp chặng đường này.
              </p>
            </div>
            <a href="mailto:careers@doangis.vn" className="about-button">
              careers@doangis.vn
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
