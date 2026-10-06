// Notebooks (spec: Notebooks-folder-picker-spec.md, mockup 03): what Jotted reads, as chips; the
// device's folders as a tree; the selected folder's detail, From now on / Everything, and its
// documents as thumbnails.

import { useEffect, useMemo, useState } from "react";
import { FolderTree } from "../components/FolderTree";
import { PageImage } from "../components/PageImage";
import { PillButton } from "../components/PillButton";
import type { Library, Settings, Status } from "../jotted/types.gen";
import {
  ancestorsOf,
  buildTree,
  coverOf,
  entriesUnder,
  findNode,
  flatten,
  folderMode,
  folderState,
  nameOf,
  normalise,
  shortName,
  type FolderNode,
} from "../store/folders";
import { folderLabel } from "../store/labels";
import { loadLibrary, setFolderMode, stopReading, toggleFolder } from "../store/settings";
import { useStore } from "../store/store";

/** What `watch from-now` said for a folder: documents already read in full. */
type AlreadyRead = { path: string; documents: string[] };

export function Notebooks() {
  const library = useStore((s) => s.library);
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [alreadyRead, setAlreadyRead] = useState<AlreadyRead | null>(null);
  useEffect(() => void loadLibrary().then((ok) => setFailed(!ok)), []);

  const tree = useMemo(() => (library ? buildTree(library.folders) : []), [library]);
  const watchedFolder = useMemo(
    () => settings && [...settings.watch].sort((a, b) => folderLabel(a).localeCompare(folderLabel(b))).find((w) => findNode(tree, w)),
    [tree, settings],
  );
  const shown = (selected && findNode(tree, selected) ? selected : null) ?? watchedFolder ?? tree[0]?.path ?? null;

  const keep = (path: string) => (result: string[] | null) => result && setAlreadyRead({ path, documents: result });
  const toggle = (path: string) => void toggleFolder(path).then(keep(path));

  return (
    <div className="notebooks">
      <header className="page-head">
        <h1>Notebooks</h1>
        <p>Tick a folder and Jotted reads it, along with every folder inside it. New writing becomes to-do items.</p>
      </header>
      {!library && <p className="empty">{failed ? "Couldn't load your notebooks." : "Loading your notebooks…"}</p>}
      {library && settings && (
        <>
          <ReadingChips library={library} settings={settings} tree={tree} onSelect={setSelected} />
          <div className="panes">
            <section className="tree-sheet" aria-label="Folders on your reMarkable">
              <FolderTree tree={tree} library={library} settings={settings} selected={shown} onSelect={setSelected} onToggle={toggle} />
            </section>
            {shown && (
              <Detail
                path={shown}
                node={findNode(tree, shown)}
                library={library}
                settings={settings}
                status={status}
                alreadyRead={alreadyRead?.path === shown ? alreadyRead.documents : []}
                onSelect={setSelected}
                onToggle={toggle}
                onMode={(mode) => void setFolderMode(shown, mode).then(keep(shown))}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- what Jotted reads

type ChipsProps = { library: Library; settings: Settings; tree: FolderNode[]; onSelect: (path: string) => void };

/** One chip per `settings.watch` entry, and how many documents they cover. */
function ReadingChips({ library, settings, tree, onSelect }: ChipsProps) {
  const chips = settings.watch.map((w) => {
    const node = findNode(tree, w);
    if (node) return { path: w, label: folderLabel(w), inside: flatten(node.children).length, documents: node.documents, select: w };
    if (normalise(w) === "/") return { path: w, label: "Everything", inside: 0, documents: library.documents.length, select: null };
    const doc = library.documents.find((d) => normalise(d.path) === normalise(w));
    return { path: w, label: doc ? nameOf(doc.path) : folderLabel(w), inside: 0, documents: doc ? 1 : 0, select: doc?.folder ?? null };
  });
  chips.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  const total = chips.reduce((n, c) => n + c.documents, 0);
  return (
    <div className="reading" aria-live="polite">
      {chips.length === 0 ? (
        <span className="reading-none">Jotted isn't reading any folders yet.</span>
      ) : (
        <>
          <span className="reading-label">
            Reading <strong>{plural(total, "document")}</strong> in
          </span>
          {chips.map((c) => (
            <span key={c.path} className="chip">
              <button type="button" className="chip-name" onClick={() => c.select && onSelect(c.select)}>
                {c.label}
                {c.inside > 0 && <small>+{c.inside} inside</small>}
              </button>
              <button type="button" className="chip-x" aria-label={`Stop reading ${c.label}`} onClick={() => void stopReading(c.path)}>
                ×
              </button>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the selected folder

type DetailProps = {
  path: string;
  node: FolderNode | null;
  library: Library;
  settings: Settings;
  status: Status | null;
  alreadyRead: string[];
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onMode: (mode: "from-now" | "everything") => void;
};

function Detail({ path, node, library, settings, status, alreadyRead, onSelect, onToggle, onMode }: DetailProps) {
  const state = folderState(path, settings.watch);
  const name = shortName(path);
  const cover = coverOf(path, settings.watch);
  const inside = node ? flatten(node.children).length : 0;
  const documents = node?.documents ?? 0;
  const parents = ancestorsOf(path);
  const mode = folderMode(path, library, settings.from_now);

  let line: React.ReactNode;
  if (state === "on") {
    line = inside ? (
      <>
        Jotted reads <strong>{name}</strong> and the {plural(inside, "folder")} inside it: {plural(documents, "document")}.
      </>
    ) : (
      <>
        Jotted reads <strong>{name}</strong>: {plural(documents, "document")}.
      </>
    );
  } else if (state === "inherited") {
    line = (
      <>
        Read because <strong>{folderLabel(cover ?? "/") || "Everything"}</strong> is ticked. To choose this folder on its own, untick {shortName(cover ?? "/")}.
      </>
    );
  } else if (state === "partial") {
    const under = entriesUnder(path, settings.watch);
    line = (
      <>
        Not read, but Jotted reads{" "}
        {under.map((w, i) => (
          <span key={w}>
            {i > 0 && ", "}
            <strong>{shortName(w)}</strong>
          </span>
        ))}{" "}
        inside it. Ticking {name} covers those too.
      </>
    );
  } else {
    line = <>Not read. Tick it to turn its new writing into to-do items{inside ? `, along with the ${plural(inside, "folder")} inside it` : ""}.</>;
  }

  return (
    <section className="detail" aria-labelledby="detail-title">
      <div className="detail-card" aria-live="polite">
        <div className="crumbs">
          {parents.length === 0 ? (
            <span>On your reMarkable</span>
          ) : (
            parents.map((p) => (
              <span key={p}>
                <button type="button" className="link-button" onClick={() => onSelect(p)}>
                  {nameOf(p)}
                </button>
                <span aria-hidden="true"> › </span>
              </span>
            ))
          )}
        </div>
        <div className="detail-head">
          <h2 id="detail-title">{name}</h2>
          {state === "on" ? (
            <PillButton onClick={() => onToggle(path)}>Stop reading</PillButton>
          ) : state === "inherited" && cover ? (
            <PillButton onClick={() => onSelect(cover)}>Go to {shortName(cover)}</PillButton>
          ) : (
            <PillButton primary onClick={() => onToggle(path)}>
              Read this folder
            </PillButton>
          )}
        </div>
        <p className="detail-status">{line}</p>
        {state === "on" && (
          <>
            <div className="modes" role="radiogroup" aria-label={`Which pages of ${name}`}>
              <button type="button" role="radio" className="mode" aria-checked={mode === "from-now"} onClick={() => mode !== "from-now" && onMode("from-now")}>
                <b>From now on</b>
                <span>Only writing added from today becomes items.</span>
              </button>
              <button
                type="button"
                role="radio"
                className="mode"
                aria-checked={mode === "everything" || mode === "empty"}
                onClick={() => mode !== "everything" && mode !== "empty" && onMode("everything")}
              >
                <b>Everything</b>
                <span>Pages already written count too.</span>
              </button>
            </div>
            {mode === "mixed" && <p className="detail-note">Some documents here read everything, some only new writing.</p>}
            {alreadyRead.length > 0 && (
              <p className="detail-note">Already read in full, so nothing is skipped: {alreadyRead.map(nameOf).join(", ")}.</p>
            )}
          </>
        )}
      </div>
      {node && node.children.length > 0 && (
        <div>
          <h3 className="sub-head">Folders inside</h3>
          <div className="subfolders">
            {node.children.map((c) => (
              <button key={c.path} type="button" className="subfolder" onClick={() => onSelect(c.path)}>
                {c.name}
                <small>{c.documents}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <Documents library={library} folder={path} status={status} />
    </section>
  );
}

/** The documents directly in this folder (not its subfolders), as thumbnails. */
function Documents({ library, folder, status }: { library: Library; folder: string; status: Status | null }) {
  const docs = library.documents.filter((d) => normalise(d.folder) === normalise(folder));
  return (
    <div className="documents">
      <h3 className="sub-head">Documents in this folder · {docs.length}</h3>
      {docs.length === 0 && <p className="empty">No documents directly in this folder.</p>}
      <ul className="thumbs">
        {docs.map((d) => {
          const name = nameOf(d.path) || d.path;
          const isTodo = !!status && d.folder === status.todo.folder && name === status.todo.name;
          const note = isTodo ? "made by Jotted · not read" : d.read ? "read" : d.watched ? "not read yet" : "not read";
          return (
            <li key={d.id} className="thumb">
              <PageImage className="thumb-page" docId={d.id} page={1} width={240} alt={`${name}, page 1`} />
              <span className="thumb-name">{name}</span>
              <span className="thumb-note">{note}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
