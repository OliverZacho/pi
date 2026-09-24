import styles from "./brand-locked-skeleton.module.css";

/**
 * The blurred dashboard behind the paywall, as pure shape.
 *
 * This replaces rendering the nine real chart components against a shared fake
 * dataset. That approach put roughly 780 words of byte-identical text into
 * every one of the 450 brand pages — fabricated subject lines, invented fonts,
 * a made-up "482 recent emails", and a fictional brand name sitting next to the
 * real one in the page title. Duplicated across the catalogue it read as scaled
 * boilerplate; next to a real brand's name it was simply wrong.
 *
 * None of that text was ever legible. `.preview` applies `blur(5px)` to ~14px
 * body copy, which erases glyphs entirely and leaves word-shaped smudges. So
 * the sample data bought nothing a text-free shape cannot, and the shape costs
 * no words, no fabricated figures and no asset to keep in sync.
 *
 * Every element here is decorative. The whole subtree is `aria-hidden` at the
 * call site, contains no text nodes, and is deterministic (fixed arrays, no
 * `Math.random`) so server and client markup agree.
 */

/**
 * Fixed pseudo-random fill for the calendar grid. Hand-tuned rather than
 * generated so the density reads like real, irregular send behaviour: clustered
 * weekdays, thinner weekends, occasional quiet stretches.
 */
function isFilled(index: number): 0 | 1 | 2 {
  const dayOfWeek = index % 7;
  // Weekends stay sparse, which is what most brands' calendars look like.
  const weekendPenalty = dayOfWeek === 0 || dayOfWeek === 6 ? 5 : 0;
  const noise = (index * 2654435761) % 11;
  if (noise + weekendPenalty > 8) return 0;
  return noise % 3 === 0 ? 2 : 1;
}

/** Bar heights for the 26-week cadence sparkline, as percentages. */
const CADENCE_BARS = [
  34, 52, 20, 68, 40, 82, 50, 36, 64, 48, 22, 70, 86, 54, 38, 66, 46, 78, 32,
  62, 50, 30, 84, 58, 44, 92
];

/** Row widths for list-style cards, as percentages of the track. */
const LIST_ROWS = [88, 62, 48, 34, 24, 16];

/** Pill widths for the CTA cloud, in rem. */
const PILLS = [7.5, 5.25, 8.75, 6, 4.5, 9.5, 5.75, 6.75, 4, 8];

function Card({
  children,
  wide
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? `${styles.card} ${styles.cardWide}` : styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.eyebrow} />
        <span className={styles.title} />
        <span className={styles.sub} />
      </div>
      {children}
    </div>
  );
}

export default function BrandLockedPreviewSkeleton({
  includeTopRows
}: {
  /**
   * False when the live teaser above is already showing the brand's real KPI
   * tiles and calendar, so the skeleton drops its copies and nothing appears
   * twice. Mirrors the behaviour the sample-fed version had.
   */
  includeTopRows: boolean;
}) {
  return (
    <div className={styles.root}>
      {includeTopRows ? (
        <>
          <div className={styles.kpiRow}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={styles.kpi}>
                <span className={styles.kpiLabel} />
                <span className={styles.kpiValue} />
                <span className={styles.kpiFoot} />
              </div>
            ))}
          </div>

          <Card wide>
            <div className={styles.calendar}>
              {Array.from({ length: 371 }, (_, i) => {
                const level = isFilled(i);
                return (
                  <i
                    key={i}
                    className={
                      level === 0
                        ? styles.cell
                        : level === 1
                          ? `${styles.cell} ${styles.cellLow}`
                          : `${styles.cell} ${styles.cellHigh}`
                    }
                  />
                );
              })}
            </div>
          </Card>
        </>
      ) : null}

      {/* Send-hours dial. */}
      <Card wide>
        <div className={styles.dialRow}>
          <div className={styles.dial}>
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                className={styles.wedge}
                style={{
                  transform: `rotate(${i * 15}deg)`,
                  opacity: 0.15 + ((i * 7) % 10) / 12
                }}
              />
            ))}
            <span className={styles.dialHub} />
          </div>
          <div className={styles.dialStats}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.stat}>
                <span className={styles.statLabel} />
                <span className={styles.statValue} />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Cadence sparkline + category breakdown. */}
      <div className={styles.grid}>
        <Card>
          <div className={styles.bars}>
            {CADENCE_BARS.map((height, i) => (
              <span
                key={i}
                className={styles.bar}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </Card>
        <Card>
          <div className={styles.list}>
            {LIST_ROWS.map((width, i) => (
              <div key={i} className={styles.listRow}>
                <span className={styles.listLabel} />
                <span className={styles.listTrack}>
                  <span
                    className={styles.listFill}
                    style={{ width: `${width}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Design DNA: palette, type, formats, then inbox previews. */}
      <Card wide>
        <div className={styles.swatches}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span key={i} className={styles.swatch} />
          ))}
        </div>
        <div className={styles.inbox}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.inboxRow}>
              <span className={styles.avatar} />
              <span className={styles.inboxLines}>
                <span className={styles.lineWide} />
                <span className={styles.lineNarrow} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Discounting + emoji use. */}
      <div className={styles.grid}>
        <Card>
          <div className={styles.bars}>
            {CADENCE_BARS.slice(0, 14).map((height, i) => (
              <span
                key={i}
                className={styles.bar}
                style={{ height: `${Math.max(100 - height, 18)}%` }}
              />
            ))}
          </div>
        </Card>
        <Card>
          <div className={styles.list}>
            {LIST_ROWS.slice(0, 4).map((width, i) => (
              <div key={i} className={styles.listRow}>
                <span className={styles.listLabel} />
                <span className={styles.listTrack}>
                  <span
                    className={styles.listFill}
                    style={{ width: `${width}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* CTA cloud. */}
      <Card wide>
        <div className={styles.pills}>
          {PILLS.map((width, i) => (
            <span
              key={i}
              className={styles.pill}
              style={{ width: `${width}rem` }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
