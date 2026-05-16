import styles from "./landing.module.css";

type EmailCard = {
  kind: "email";
  top: string;
  left: string;
  width: number;
  height: number;
  rotate: number;
  c1: string;
  c2: string;
  depth?: "fade" | "fadeMore";
  hideOnMobile?: boolean;
};

type LogoCard = {
  kind: "logo";
  top: string;
  left: string;
  width: number;
  height: number;
  rotate: number;
  bg: string;
  fg: string;
  letter?: string;
  shape?: "letter" | "circle";
  depth?: "fade" | "fadeMore";
  hideOnMobile?: boolean;
};

type Card = EmailCard | LogoCard;

// Hand-tuned layout: scattered around the page but kept clear of the central
// headline column. These are intentionally static placeholders — the next pass
// will replace them with animated email previews and brand logos.
const CARDS: Card[] = [
  // ---- Left cluster ----
  {
    kind: "email",
    top: "10%", left: "5%", width: 96, height: 116, rotate: 6,
    c1: "#e6dfd4", c2: "#cdc1ad",
    depth: "fade"
  },
  {
    kind: "logo",
    top: "16%", left: "22%", width: 72, height: 72, rotate: -14,
    bg: "#f3ede1", fg: "#0b0b0c", letter: "P", depth: "fade",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "26%", left: "2%", width: 84, height: 96, rotate: -12,
    c1: "#cbd1de", c2: "#9aa3b8", depth: "fadeMore",
    hideOnMobile: true
  },
  {
    kind: "logo",
    top: "44%", left: "12%", width: 80, height: 80, rotate: -8,
    bg: "#1c1c1d", fg: "#ffffff", letter: "A"
  },
  {
    kind: "email",
    top: "60%", left: "4%", width: 92, height: 112, rotate: 14,
    c1: "#e1c8c2", c2: "#bf8e83", depth: "fade"
  },
  {
    kind: "logo",
    top: "78%", left: "16%", width: 84, height: 84, rotate: -4,
    bg: "#5c6cff", fg: "#ffffff", letter: "M",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "82%", left: "26%", width: 80, height: 92, rotate: 8,
    c1: "#d2dbe0", c2: "#a3afb8", depth: "fadeMore",
    hideOnMobile: true
  },

  // ---- Right cluster ----
  {
    kind: "logo",
    top: "12%", left: "78%", width: 72, height: 72, rotate: 14,
    bg: "#241f1d", fg: "#f1d6c1", letter: "K", depth: "fade",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "9%", left: "88%", width: 90, height: 108, rotate: -8,
    c1: "#dad3c4", c2: "#a8a08c", depth: "fade"
  },
  {
    kind: "logo",
    top: "26%", left: "84%", width: 76, height: 76, rotate: -10,
    bg: "#0e2b22", fg: "#caebd0", letter: "L", depth: "fade",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "44%", left: "90%", width: 92, height: 112, rotate: -6,
    c1: "#f3d6b0", c2: "#cd9b56"
  },
  {
    kind: "logo",
    top: "62%", left: "80%", width: 80, height: 80, rotate: 12,
    bg: "#ffffff", fg: "#0b0b0c", shape: "circle"
  },
  {
    kind: "email",
    top: "76%", left: "86%", width: 88, height: 100, rotate: -4,
    c1: "#c1cfd6", c2: "#7a8d96", depth: "fadeMore"
  },

  // ---- Top + bottom center accents ----
  {
    kind: "logo",
    top: "4%", left: "36%", width: 70, height: 70, rotate: -8,
    bg: "#e9e3d6", fg: "#0b0b0c", letter: "C", depth: "fade",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "6%", left: "60%", width: 86, height: 96, rotate: 6,
    c1: "#cdd2c4", c2: "#94a08a", depth: "fade",
    hideOnMobile: true
  },
  {
    kind: "email",
    top: "88%", left: "40%", width: 92, height: 102, rotate: -8,
    c1: "#cad7d2", c2: "#7e9991", depth: "fade"
  },
  {
    kind: "logo",
    top: "90%", left: "58%", width: 70, height: 70, rotate: 12,
    bg: "#2a2422", fg: "#f7e6c1", letter: "R"
  }
];

export default function FloatingCards() {
  return (
    <div className={styles.floatLayer} aria-hidden="true">
      {CARDS.map((card, i) => {
        const positionStyle: React.CSSProperties = {
          top: card.top,
          left: card.left,
          width: card.width,
          height: card.height,
          transform: `translate(-50%, -50%) rotate(${card.rotate}deg)`
        };

        const depthClass =
          card.depth === "fadeMore"
            ? styles.fadeMore
            : card.depth === "fade"
              ? styles.fade
              : "";

        const className = [
          styles.card,
          card.kind === "email" ? styles.emailCard : styles.logoCard,
          depthClass,
          card.hideOnMobile ? styles.hideOnMobile : ""
        ]
          .filter(Boolean)
          .join(" ");

        if (card.kind === "email") {
          const style = {
            ...positionStyle,
            ["--c1" as string]: card.c1,
            ["--c2" as string]: card.c2
          } as React.CSSProperties;
          return (
            <div key={i} className={className} style={style}>
              <div className={styles.emailHeader}>
                <span className={styles.emailDot} />
                <span className={styles.emailSubject} />
              </div>
              <div className={styles.emailBody} />
            </div>
          );
        }

        const style = {
          ...positionStyle,
          ["--c1" as string]: card.bg,
          color: card.fg
        } as React.CSSProperties;
        return (
          <div key={i} className={className} style={style}>
            {card.shape === "circle" ? (
              <div className={styles.logoMarkCircle} />
            ) : (
              <span className={styles.logoMarkLetter}>{card.letter ?? "•"}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
