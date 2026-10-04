// The real strokes of a handwritten line, as SVG from `jotted image line DOC ANCHOR`.
// Cached for the session by doc + anchor. Shown as an <img>, so the SVG can't run anything.

import { useEffect, useState } from "react";
import { imageLine } from "../jotted/client";

const cache = new Map<string, Promise<string>>();

export function inkUrl(docId: string, anchor: string): Promise<string> {
  const key = `${docId}/${anchor}`;
  let url = cache.get(key);
  if (!url) {
    url = imageLine(docId, anchor).then((d) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`);
    url.catch(() => cache.delete(key)); // try again next time
    cache.set(key, url);
  }
  return url;
}

type Props = { docId: string; anchor: string; text: string };

/** The ink, with the transcript as its accessible text (and shown until the ink arrives). */
export function InkImage({ docId, anchor, text }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    inkUrl(docId, anchor).then((u) => live && setSrc(u), () => {});
    return () => {
      live = false;
    };
  }, [docId, anchor]);
  return src ? <img className="ink" src={src} alt={text} draggable={false} /> : <span>{text}</span>;
}
