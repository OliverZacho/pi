"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { RENDER_WIDTH, subscribeToPreviewWidth } from "@/lib/preview-width";

/**
 * What a thumbnail card needs to know about its preview frame: the width to
 * lay the email out at, and when to swap the skeleton for the frame.
 *
 * Width starts at the 600px default and only ever widens to the document's
 * natural width, so wider layouts sit centred instead of showing their left
 * edge.
 *
 * The reveal follows the document's own "ready" report, which means the part
 * of the email the thumbnail actually shows has loaded. The frame's `load`
 * event used to be the signal, but it waited for every image in the email,
 * most of them far below the visible crop, so a cold grid sat on skeletons
 * for seconds and then appeared in one go. Thumbnail images are lazy now and
 * `load` fires before they arrive, so it only reveals a document that never
 * reports readiness: one cached from before the script did, or one whose
 * script could not run.
 *
 * `active` is false while the frame is not mounted yet (EmailCard defers it
 * until the card nears the viewport).
 */
export function usePreviewFrame(
  frameRef: RefObject<HTMLIFrameElement | null>,
  active: boolean
) {
  const [renderWidth, setRenderWidth] = useState(RENDER_WIDTH);
  const [loaded, setLoaded] = useState(false);
  const reportsReady = useRef(false);

  useEffect(() => {
    if (!active) return;
    const frame = frameRef.current;
    if (!frame) return;
    return subscribeToPreviewWidth(
      frame,
      (natural) => {
        setRenderWidth((current) => (natural > current ? natural : current));
      },
      (ready) => {
        reportsReady.current = true;
        if (ready) setLoaded(true);
      }
    );
  }, [active, frameRef]);

  const onFrameLoad = useCallback(() => {
    if (!reportsReady.current) setLoaded(true);
  }, []);

  return { renderWidth, loaded, onFrameLoad };
}
