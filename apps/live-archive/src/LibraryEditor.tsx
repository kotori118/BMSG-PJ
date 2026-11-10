import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  type Dataset,
  type Entry,
  type Show,
  type Song,
} from "../shared/model";
import {
  importPreview,
  templateImpact,
  validateDataset,
  medley,
} from "../shared/domain";

type Props = {
  data: Dataset;
  songs: Song[];
  disabled: boolean;
  onSave: (data: Dataset, deletedShowIds?: string[]) => Promise<void>;
  onDirty: (dirty: boolean) => void;
};
export function LibraryEditor({
  data,
  songs,
  disabled,
  onSave,
  onDirty,
}: Props) {
  const [draft, setDraft] = useState<Dataset | null>(null),
    [pane, setPane] = useState<"SHOWS" | "TEMPLATES">("SHOWS"),
    [tourId, setTourId] = useState(""),
    [tourName, setTourName] = useState(""),
    [type, setType] = useState<"TOUR" | "FANMEETING" | "SPECIAL">("TOUR"),
    [time, setTime] = useState(""),
    [text, setText] = useState(""),
    [preview, setPreview] = useState<{
      shows: Show[];
      duplicates: Show[];
    } | null>(null),
    [templateId, setTemplateId] = useState(""),
    [name, setName] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState("");
  const begin = () => {
    setDraft(structuredClone(data));
    onDirty(true);
  };
  const close = () => {
    setDraft(null);
    setPreview(null);
    onDirty(false);
  };
  const working = draft ?? data;
  const prepareShows = () => {
    try {
      const selected = working.tours.find((t) => t.id === tourId),
        resolvedId =
          selected?.id || (tourName.trim() ? crypto.randomUUID() : null);
      if (type === "TOUR" && !resolvedId)
        throw new Error("ツアーを選択するか名前を入力してください");
      const shows: Show[] = text
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const [
            date,
            venue,
            region = "",
            slot = "夜",
            format = "OTHER",
            startTime = "",
          ] = line.split("|").map((x) => x.trim());
          const starts = startTime || time || selected?.defaultTime;
          return {
            id: crypto.randomUUID(),
            revision: 0,
            tourId: resolvedId,
            name: selected?.name || tourName || "単独特別公演",
            type,
            format: format as Show["format"],
            date,
            venue,
            region,
            slot,
            startsAt: starts ? `${date}T${starts}:00+09:00` : null,
            templateId: null,
            hasSavedSetlist: false,
            surpriseReview: "UNREVIEWED",
            note: "",
          };
        });
      if (!shows.length) throw new Error("公演日程を入力してください");
      const incoming = { ...working, shows };
      const result = importPreview(working, incoming);
      const next = structuredClone(working);
      if (!selected && resolvedId && result.shows.length)
        next.tours.push({
          id: resolvedId,
          revision: 0,
          name: tourName,
          type,
          startDate: result.shows.map((s) => s.date).sort()[0],
          endDate: result.shows
            .map((s) => s.date)
            .sort()
            .at(-1)!,
          defaultTime: time || null,
          releaseIds: [],
        });
      next.shows.push(...result.shows);
      if(selected && result.shows.length) next.tours=next.tours.map(t=>t.id===selected.id?{...t,startDate:[t.startDate,...result.shows.map(s=>s.date)].sort()[0],endDate:[t.endDate,...result.shows.map(s=>s.date)].sort().at(-1)!}:t);
      validateDataset(next);
      setDraft(next);
      setPreview(result);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveShows = async () => {
    try {
      if (!draft || !preview) return;
      await onSave(draft);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveTemplate = async () => {
    try {
      if (!draft) throw new Error("編集を開始してください");
      if (!tourId) throw new Error("ツアーを選択してください");
      const old = draft.templates.find((t) => t.id === templateId),
        template = {
          id: old?.id ?? crypto.randomUUID(),
          revision: (old?.revision ?? -1) + 1,
          tourId,
          name,
          entries,
        };
      const impact = templateImpact(draft, template);
      const conflict = impact.find((x) => x.conflict);
      if (conflict) throw new Error(`${conflict.showId}: ${conflict.conflict}`);
      if (
        impact.length &&
        !confirm(
          `${impact.length}公演へ反映します。公演ごとの差分を維持して保存しますか？`,
        )
      )
        return;
      const next = {
        ...draft,
        templates: [
          ...draft.templates.filter((t) => t.id !== template.id),
          template,
        ],
      };
      validateDataset(next);
      await onSave(next);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!draft)
    return (
      <section className="card fields">
        <h2>公演・基本セトリ</h2>
        <button disabled={disabled} onClick={begin}>
          <Plus size={16} />
          追加・編集
        </button>
      </section>
    );
  return (
    <section className="card fields">
      <div className="page-title">
        <h2>公演・基本セトリ</h2>
        <button
          aria-label="編集を閉じる"
          disabled={disabled}
          onClick={() => {
            if (confirm("保存していない変更を破棄しますか？")) close();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="segmented">
        <button
          className={pane === "SHOWS" ? "selected" : ""}
          onClick={() => setPane("SHOWS")}
        >
          公演を追加
        </button>
        <button
          className={pane === "TEMPLATES" ? "selected" : ""}
          onClick={() => setPane("TEMPLATES")}
        >
          基本セトリ
        </button>
      </div>
      <label>
        ツアー
        <select
          value={tourId}
          disabled={!!preview}
          onChange={(e) => {
            setTourId(e.target.value);
            setTemplateId("");
            setEntries([]);
          }}
        >
          <option value="">新規ツアー・単独公演</option>
          {working.tours.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {!tourId && (
        <label>
          ツアー名（単独公演なら空欄可）
          <input
            value={tourName}
            disabled={!!preview}
            onChange={(e) => setTourName(e.target.value)}
          />
        </label>
      )}
      {pane === "SHOWS" ? (
        <>
          <label>
            公演種別
            <select
              value={type}
              disabled={!!preview}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="TOUR">ツアー</option>
              <option value="FANMEETING">ファンミ</option>
              <option value="SPECIAL">単独特別公演</option>
            </select>
          </label>
          <label>
            共通開演時刻（任意）
            <input
              type="time"
              disabled={!!preview}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            公演日程
            <textarea
              disabled={!!preview}
              placeholder={
                "2024-03-02 | 東京ドーム | 東京 | 夜 | DOME | 17:00\n2024-03-03 | 東京ドーム | 東京 | 夜 | DOME | 17:00"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p>日付 | 会場 | 地域 | 公演回 | 会場形式 | 開演時刻（任意）</p>
          {!preview ? (
            <button disabled={disabled} onClick={prepareShows}>
              登録内容を確認
            </button>
          ) : (
            <>
              <h2>追加 {preview.shows.length}公演</h2>
              {preview.shows.map((s) => (
                <p key={s.id}>
                  {s.date} · {s.venue} · {s.slot}
                </p>
              ))}
              {preview.duplicates.length > 0 && (
                <>
                  <h2>重複のため除外 {preview.duplicates.length}公演</h2>
                  {preview.duplicates.map((s) => (
                    <p key={s.id}>
                      {s.date} · {s.venue} · {s.slot}
                    </p>
                  ))}
                </>
              )}
              <button
                className="primary"
                disabled={disabled || !preview.shows.length}
                onClick={() => void saveShows()}
              >
                確認して登録
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <label>
            基本セトリ
            <select
              value={templateId}
              onChange={(e) => {
                const t = working.templates.find(
                  (t) => t.id === e.target.value,
                );
                setTemplateId(e.target.value);
                setName(t?.name ?? "");
                setEntries(structuredClone(t?.entries ?? []));
              }}
            >
              <option value="">新規作成</option>
              {working.templates
                .filter((t) => t.tourId === tourId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <EntryEditor entries={entries} songs={songs} onChange={setEntries} />
          <button
            className="primary"
            disabled={disabled || !tourId || !name.trim()}
            onClick={() => void saveTemplate()}
          >
            影響を確認して保存
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function EntryEditor({
  entries,
  songs,
  onChange,
}: {
  entries: Entry[];
  songs: Song[];
  onChange: (entries: Entry[]) => void;
}) {
  const [text, setText] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const patch = (id: string, value: Partial<Entry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...value } : e)));
  const add = (song: Song): Entry => ({
    id: crypto.randomUUID(),
    songRef: song.ref,
    section: "MAIN",
    version: "FULL",
    medleyGroup: null,
    performance: song.ref.startsWith("L:") ? "OTHER" : "ORIGINAL",
    members: [],
  });
  const paste = () => {
    const added: Entry[] = [];
    for (const raw of text
      .split("\n")
      .map((x) => x.replace(/^\s*\d+[.、)\s]+/, "").trim())
      .filter(Boolean)) {
      const title = raw.replace(/\s*\[(FULL|SHORT)\]$/i, "");
      const matches = songs.filter(
        (s) =>
          s.title.normalize("NFKC").toLowerCase() ===
          title.normalize("NFKC").toLowerCase(),
      );
      if (matches.length !== 1) {
        setError(
          `「${title}」は検索候補から選択してください。貼付内容は保持しています`,
        );
        return;
      }
      added.push({
        ...add(matches[0]),
        version: /\[SHORT\]$/i.test(raw) ? "SHORT" : "FULL",
      });
    }
    onChange([...entries, ...added]);
    setText("");
    setError("");
  };
  return (
    <div className="fields">
      <textarea
        aria-label="セットリストを貼り付け"
        placeholder="曲名を1行ずつ貼り付け"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button onClick={paste}>まとめて追加</button>
      <label>
        曲名で検索
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {search && (
        <div className="song-matches">
          {songs
            .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 12)
            .map((s) => (
              <button
                key={s.ref}
                onClick={() => {
                  onChange([...entries, add(s)]);
                  setSearch("");
                }}
              >
                {s.title} · {s.artist ?? "—"}
              </button>
            ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="actions">
          <button
            onClick={() => {
              const positions = selected
                .map((id) => entries.findIndex((e) => e.id === id))
                .sort((a, b) => a - b);
              if (
                positions.some((n, i) => i > 0 && n !== positions[i - 1] + 1)
              ) {
                setError("連続する曲を選択してください");
                return;
              }
              const group = crypto.randomUUID();
              onChange(
                entries.map((e) =>
                  selected.includes(e.id) ? medley(e, group) : e,
                ),
              );
              setSelected([]);
            }}
          >
            選択曲をメドレーにする
          </button>
          <button
            onClick={() => {
              onChange(
                entries.map((e) =>
                  selected.includes(e.id) ? medley(e, null) : e,
                ),
              );
              setSelected([]);
            }}
          >
            メドレーを解除
          </button>
        </div>
      )}
      {entries.map((e, i) => (
        <div className="edit-entry" key={e.id}>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={selected.includes(e.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, e.id]
                    : selected.filter((x) => x !== e.id),
                )
              }
            />
            <strong>
              {i + 1}.{" "}
              {songs.find((s) => s.ref === e.songRef)?.title ?? e.songRef}
            </strong>
          </label>
          <div className="entry-controls">
            <select
              aria-label="本編またはアンコール"
              value={e.section}
              onChange={(event) =>
                patch(e.id, { section: event.target.value as Entry["section"] })
              }
            >
              <option value="MAIN">本編</option>
              <option value="ENCORE">アンコール</option>
            </select>
            <select
              aria-label="FULLまたはSHORT"
              value={e.version ?? "UNKNOWN"}
              onChange={(event) =>
                patch(e.id, {
                  version:
                    event.target.value === "UNKNOWN"
                      ? null
                      : (event.target.value as Entry["version"]),
                })
              }
            >
              <option>FULL</option>
              <option>SHORT</option>
              <option value="UNKNOWN">—</option>
            </select>
            {e.medleyGroup && <span className="badge">メドレー</span>}
            <select
              aria-label="披露形態"
              value={e.performance}
              onChange={(event) =>
                patch(e.id, {
                  performance: event.target.value as Entry["performance"],
                })
              }
            >
              <option value="ORIGINAL">オリジナル</option>
              <option value="COVER">カバー</option>
              <option value="SOLO">ソロ</option>
              <option value="UNIT">ユニット</option>
              <option value="OTHER">その他</option>
            </select>
            <button
              disabled={!i}
              aria-label="上へ"
              onClick={() => {
                const next = [...entries];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              ↑
            </button>
            <button
              disabled={i === entries.length - 1}
              aria-label="下へ"
              onClick={() => {
                const next = [...entries];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              ↓
            </button>
            <button
              aria-label="この曲を削除"
              onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
