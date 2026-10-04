// Notebooks (spec: Screens › 5, mockup 03): the device's folders, which ones Jotted reads, and
// from when; a folder's documents as thumbnails.

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "../components/Checkbox";
import { PageImage } from "../components/PageImage";
import type { Library, Settings, Status } from "../jotted/types.gen";
import { folderLabel } from "../store/labels";
import { loadLibrary, watchFolder } from "../store/settings";
import { useStore } from "../store/store";

export function Notebooks() {
  const library = useStore((s) => s.library);
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => void loadLibrary().then((ok) => setFailed(!ok)), []);

  const folders = useMemo(() => (library ? [...library.folders].sort((a, b) => a.path.localeCompare(b.path)) : []), [library]);
  const shown = selected ?? folders.find((f) => settings?.watch.includes(f.path))?.path ?? folders[0]?.path ?? null;

  return (
    <div className="notebooks">
      <header className="page-head">
        <h1>Notebooks</h1>
        <p>Tick what Jotted should read. New writing becomes items; choose whether older pages count too.</p>
      </header>
      {!library && <p className="empty">{failed ? "Couldn't load your notebooks." : "Loading your notebooks…"}</p>}
      {library && settings && (
        <FolderPicker folders={folders} settings={settings} selected={shown} onSelect={setSelected} />
      )}
      {library && shown && <Documents library={library} folder={shown} status={status} />}
    </div>
  );
}

type PickerProps = {
  folders: Library["folders"];
  settings: Settings;
  selected?: string | null;
  onSelect?: (path: string) => void;
  compact?: boolean;
};

/** Folder cards: "Read this folder", then From now on / Everything. Also Setup's picker. */
export function FolderPicker({ folders, settings, selected, onSelect, compact }: PickerProps) {
  return (
    <ul className={`folders ${compact ? "folders-compact" : ""}`} aria-label="Folders">
      {folders.map((f) => {
        const watched = settings.watch.includes(f.path);
        const fromNow = settings.from_now.includes(f.path);
        const name = folderLabel(f.path) || "Top level";
        return (
          <li key={f.path} className={`folder ${watched ? "folder-on" : ""} ${selected === f.path ? "folder-selected" : ""}`}>
            <div className="folder-head">
              {onSelect ? (
                <button type="button" className="folder-name" aria-pressed={selected === f.path} onClick={() => onSelect(f.path)}>
                  {name}
                </button>
              ) : (
                <span className="folder-name">{name}</span>
              )}
              <span className="folder-count" aria-label={`${f.documents} documents`}>
                {f.documents}
              </span>
            </div>
            <label className="folder-read">
              <Checkbox checked={watched} label={`Read ${name}`} onChange={() => void watchFolder(watched ? "remove" : "add", f.path)} />
              <span aria-hidden="true">Read this folder</span>
            </label>
            {watched && (
              <div className="segmented" role="radiogroup" aria-label={`Which pages of ${name}`}>
                <button type="button" role="radio" aria-checked={fromNow} className={fromNow ? "seg-on" : ""} onClick={() => !fromNow && void watchFolder("from-now", f.path)}>
                  From now on
                </button>
                <button type="button" role="radio" aria-checked={!fromNow} className={!fromNow ? "seg-on" : ""} onClick={() => fromNow && void watchFolder("read-all", f.path)}>
                  Everything
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Documents({ library, folder, status }: { library: Library; folder: string; status: Status | null }) {
  const docs = library.documents.filter((d) => d.folder === folder);
  return (
    <section className="documents" aria-labelledby="documents-title">
      <h2 id="documents-title">{folderLabel(folder) || "Top level"}</h2>
      {docs.length === 0 && <p className="empty">No documents in this folder.</p>}
      <ul className="thumbs">
        {docs.map((d) => {
          const name = d.path.split("/").filter(Boolean).pop() ?? d.path;
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
    </section>
  );
}
