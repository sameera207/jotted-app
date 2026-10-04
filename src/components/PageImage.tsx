// A notebook page as SVG from `jotted image page`, cached for the session by doc, page and
// anchor. Shown as an <img>, so the SVG can't run anything. Pages Jotted hasn't read can't be
// drawn (`not_found`): those show a blank sheet with their name.

import { useEffect, useState } from "react";
import { imagePage } from "../jotted/client";

const cache = new Map<string, Promise<string>>();

function pageUrl(docId: string, page: number, anchor?: string, width?: number): Promise<string> {
  const key = `${docId}/${page}/${anchor ?? ""}/${width ?? ""}`;
  let url = cache.get(key);
  if (!url) {
    url = imagePage(docId, page, { anchor, width }).then((d) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`);
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

type Props = { docId: string; page: number; anchor?: string; width?: number; alt: string; className?: string };

export function PageImage({ docId, page, anchor, width, alt, className }: Props) {
  const [state, setState] = useState<{ src: string } | "loading" | "blank">("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    pageUrl(docId, page, anchor, width).then(
      (src) => live && setState({ src }),
      () => live && setState("blank"),
    );
    return () => {
      live = false;
    };
  }, [docId, page, anchor, width]);
  if (typeof state === "object") return <img className={className} src={state.src} alt={alt} draggable={false} />;
  return <div className={`${className ?? ""} page-blank`} role="img" aria-label={state === "loading" ? `Loading ${alt}` : alt} />;
}
