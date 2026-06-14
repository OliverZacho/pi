import DocsSiteHeader from "@/components/docs/DocsSiteHeader";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Tutorials — Pirol",
  description:
    "Video tutorials for everything you can do in Pirol — exploring competitor email, building collections, comparing brands, and more."
};

type Tutorial = {
  chapter: string;
  title: string;
  description: string;
  duration: string;
};

type TutorialSection = {
  heading: string;
  tutorials: Tutorial[];
};

const SECTIONS: TutorialSection[] = [
  {
    heading: "Get started",
    tutorials: [
      {
        chapter: "Basics",
        title: "Welcome to Pirol",
        description:
          "A two-minute tour of the workspace — the sidebar, search, and how the app is organized.",
        duration: "2:14"
      },
      {
        chapter: "Basics",
        title: "Setting up your account",
        description:
          "Sign in, invite your team, and configure the notifications that matter to you.",
        duration: "3:08"
      }
    ]
  },
  {
    heading: "Explore competitor email",
    tutorials: [
      {
        chapter: "Explore",
        title: "Browsing the email feed",
        description:
          "Filter the explore feed by brand, category, and send date to find exactly the campaigns you want.",
        duration: "4:31"
      },
      {
        chapter: "Explore",
        title: "Searching by keyword and image",
        description:
          "Use text search and image search to surface emails that match a look, a theme, or a product.",
        duration: "3:47"
      },
      {
        chapter: "Explore",
        title: "Asking AI about a campaign",
        description:
          "Ask the AI assistant to summarize tactics, spot patterns, and explain why an email works.",
        duration: "5:02"
      }
    ]
  },
  {
    heading: "Organize & compare",
    tutorials: [
      {
        chapter: "Collections",
        title: "Building and sharing collections",
        description:
          "Save standout emails into collections, add an emoji icon, and share a read-only link with your team.",
        duration: "4:10"
      },
      {
        chapter: "Compare",
        title: "Comparing brands side by side",
        description:
          "Put two or more brands next to each other to compare cadence, design, and messaging at a glance.",
        duration: "4:55"
      },
      {
        chapter: "Following",
        title: "Following brands & setting alerts",
        description:
          "Follow the brands you care about and get notified the moment they send something new.",
        duration: "3:22"
      }
    ]
  },
  {
    heading: "Account & team",
    tutorials: [
      {
        chapter: "Settings",
        title: "Managing your team and billing",
        description:
          "Invite teammates on your domain, manage roles, and handle your subscription from Settings.",
        duration: "3:39"
      }
    ]
  }
];

export default function LearnPage() {
  return (
    <div className={styles.shell}>
      <DocsSiteHeader />
      <div className={styles.simpleLayout}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Tutorials</h1>
          <p className={styles.pageLead}>
            Short video tutorials for everything you can do in Pirol. Watch end to
            end, or jump to the feature you are working on.
          </p>
        </header>

        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className={styles.learnSectionTitle}>{section.heading}</h2>
            <div className={styles.videoGrid}>
              {section.tutorials.map((tutorial) => (
                <article key={tutorial.title} className={styles.videoCard}>
                  <div className={styles.videoThumb}>
                    <span className={styles.playButton}>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                    <span className={styles.videoDuration}>{tutorial.duration}</span>
                  </div>
                  <div className={styles.videoBody}>
                    <p className={styles.videoChapter}>{tutorial.chapter}</p>
                    <h3 className={styles.videoTitle}>{tutorial.title}</h3>
                    <p className={styles.videoDesc}>{tutorial.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
