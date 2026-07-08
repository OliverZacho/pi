"use client";

import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import styles from "./checkout-auth.module.css";

/**
 * Segmented one-time-code entry that autofills on iOS/Android/Chrome.
 *
 * Built on `input-otp` (the pattern shadcn/ui ships): ONE real input with
 * `autocomplete="one-time-code"` kept technically visible — opacity 1 with
 * transparent text/caret — stretched over purely-visual digit boxes. Safari
 * refuses to autofill inputs it considers hidden (our earlier `opacity: 0.01`
 * hand-roll hit exactly that, WebKit #257804), so the library's
 * keep-it-visible trick is what makes the "From Mail" fill actually land.
 */
export default function CodeInput({
  length,
  value,
  onChange,
  disabled
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <OTPInput
      maxLength={length}
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputMode="numeric"
      pattern={REGEXP_ONLY_DIGITS}
      autoFocus
      aria-label="Verification code"
      containerClassName={styles.codeWrap}
      render={({ slots }) => (
        <div className={styles.codeBoxes}>
          {slots.map((slot, i) => (
            <div
              key={i}
              className={`${styles.codeCell} ${
                slot.isActive ? styles.codeCellActive : ""
              }`}
            >
              {slot.char ?? ""}
              {slot.hasFakeCaret ? <span className={styles.codeCaret} /> : null}
            </div>
          ))}
        </div>
      )}
    />
  );
}
