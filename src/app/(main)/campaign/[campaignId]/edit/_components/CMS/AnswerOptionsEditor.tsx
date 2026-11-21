"use client";

import { Button } from "@/components/ui/button";
import Icon from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  getFileManagerCategory,
  isValidAssetForField,
} from "@/lib/collection-field-utils";
import {
  QUIZ_LIMITS,
  generateOptionId,
  parseAnswerOptionsJson,
} from "@/lib/quiz";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Item-sheet widget for the template-only `answer_options` field (Quiz
 * questions): an ordered list of scored answer options.
 *
 * Value contract: the stored JSON text (an array of
 * `{ id, title, description?, score, icon?, image?: { asset_id } }`). The
 * editor round-trips it faithfully — existing option ids are preserved, new
 * options get a fresh id — and the server re-validates and canonicalises on
 * save, so this component only has to produce well-formed input.
 *
 * Reordering uses explicit move up / move down buttons (keyboard- and
 * screen-reader-friendly, no pointer drag required).
 */

interface OptionRow {
  id: string;
  title: string;
  description: string;
  /** Kept as text while typing ("-", "1.") and converted on emit. */
  score: string;
  icon: string;
  imageAssetId: string | null;
}

export interface AnswerOptionsEditorProps {
  /** Stored JSON text (may be empty). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Stable prefix for element ids / aria labels. */
  idPrefix?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Tolerant parse of stored text into editable rows (bad entries become blank rows). */
export function parseRows(value: string): OptionRow[] {
  const parsed = parseAnswerOptionsJson(value);
  if (parsed.kind !== "ok") return [];
  return parsed.items.map((item) => {
    const o = isRecord(item) ? item : {};
    return {
      id: typeof o.id === "string" && o.id ? o.id : generateOptionId(),
      title: typeof o.title === "string" ? o.title : "",
      description: typeof o.description === "string" ? o.description : "",
      score:
        typeof o.score === "number" && Number.isFinite(o.score)
          ? String(o.score)
          : "",
      icon: typeof o.icon === "string" ? o.icon : "",
      imageAssetId:
        isRecord(o.image) && typeof o.image.asset_id === "string"
          ? o.image.asset_id
          : null,
    };
  });
}

/**
 * Rows → stored JSON text. An unparseable score is emitted as `null` so the
 * shared validator reports "score must be a number" rather than silently
 * storing 0. Empty list ⇒ empty string (no value row is stored).
 */
export function serializeRows(rows: readonly OptionRow[]): string {
  if (rows.length === 0) return "";
  return JSON.stringify(
    rows.map((r) => {
      const score = r.score.trim() === "" ? Number.NaN : Number(r.score);
      return {
        id: r.id,
        title: r.title,
        ...(r.description.trim() ? { description: r.description } : {}),
        score: Number.isFinite(score) ? score : null,
        ...(r.icon.trim() ? { icon: r.icon } : {}),
        ...(r.imageAssetId ? { image: { asset_id: r.imageAssetId } } : {}),
      };
    }),
  );
}

/** Pure reorder helper (exported for tests). */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return [...rows];
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function AnswerOptionsEditor({
  value,
  onChange,
  disabled,
  idPrefix = "answer-options",
}: AnswerOptionsEditorProps) {
  const openFileManager = useEditorStore((s) => s.openFileManager);
  const getAsset = useAssetsStore((s) => s.getAsset);

  const [rows, setRows] = useState<OptionRow[]>(() => parseRows(value));
  // The last text this editor produced or adopted. A `value` different from it
  // is a genuine EXTERNAL change (form reset / item switch) and replaces the
  // rows; an echo of our own change is ignored, so typing never resets the
  // inputs (or the cursor). Adjusting state while rendering is React's
  // recommended way to derive state from a changed prop (no effect needed).
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setRows(parseRows(value));
  }

  const commit = (next: OptionRow[]) => {
    const text = serializeRows(next);
    setRows(next);
    setSyncedValue(text);
    onChange(text);
  };

  const update = (index: number, patch: Partial<OptionRow>) =>
    commit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const atLimit = rows.length >= QUIZ_LIMITS.optionsMax;

  const addOption = () => {
    if (atLimit) return;
    commit([
      ...rows,
      {
        id: generateOptionId(),
        title: "",
        description: "",
        score: "0",
        icon: "",
        imageAssetId: null,
      },
    ]);
  };

  const chooseImage = (index: number) => {
    openFileManager(
      (asset) => {
        if (!isValidAssetForField(asset, "image")) {
          toast.error("Invalid asset type", {
            description: "Please select an image file.",
          });
          return false;
        }
        update(index, { imageAssetId: asset.id });
      },
      rows[index].imageAssetId,
      getFileManagerCategory("image"),
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid={`${idPrefix}-editor`}>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No options yet. Add at least {QUIZ_LIMITS.optionsMin}.
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const n = index + 1;
          const asset = row.imageAssetId ? getAsset(row.imageAssetId) : null;
          return (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-lg border p-3"
              data-testid={`${idPrefix}-row`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5 shrink-0">
                  {n}.
                </span>
                <Input
                  aria-label={`Option ${n} title`}
                  placeholder="Option title"
                  value={row.title}
                  disabled={disabled}
                  maxLength={QUIZ_LIMITS.optionTitleMax}
                  onChange={(e) => update(index, { title: e.target.value })}
                />
                <Input
                  aria-label={`Option ${n} score`}
                  type="number"
                  step="any"
                  className="w-20 shrink-0"
                  placeholder="Score"
                  value={row.score}
                  disabled={disabled}
                  onChange={(e) => update(index, { score: e.target.value })}
                />
                <Input
                  aria-label={`Option ${n} icon`}
                  className="w-16 shrink-0 text-center"
                  placeholder="🙂"
                  value={row.icon}
                  disabled={disabled}
                  maxLength={QUIZ_LIMITS.optionIconMax}
                  onChange={(e) => update(index, { icon: e.target.value })}
                />
              </div>

              <Input
                aria-label={`Option ${n} description`}
                placeholder="Description (optional)"
                value={row.description}
                disabled={disabled}
                maxLength={QUIZ_LIMITS.optionDescriptionMax}
                onChange={(e) => update(index, { description: e.target.value })}
              />

              <div className="flex items-center gap-2">
                {row.imageAssetId ? (
                  <>
                    {asset?.public_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- editor thumbnail of a user asset
                      <img
                        src={asset.public_url}
                        alt=""
                        className="size-8 rounded object-cover"
                      />
                    ) : (
                      <Icon name="image" className="size-4 text-muted-foreground" />
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => chooseImage(index)}
                    >
                      Change image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove option ${n} image`}
                      onClick={() => update(index, { imageAssetId: null })}
                    >
                      Remove image
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => chooseImage(index)}
                  >
                    <Icon name="plus" className="size-3" />
                    Add image
                  </Button>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Move option ${n} up`}
                    disabled={disabled || index === 0}
                    onClick={() => commit(moveRow(rows, index, index - 1))}
                  >
                    <Icon name="chevronUp" className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Move option ${n} down`}
                    disabled={disabled || index === rows.length - 1}
                    onClick={() => commit(moveRow(rows, index, index + 1))}
                  >
                    <Icon name="chevronDown" className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove option ${n}`}
                    disabled={disabled}
                    onClick={() => commit(rows.filter((_, i) => i !== index))}
                  >
                    <Icon name="trash" className="size-3" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-fit"
        disabled={disabled || atLimit}
        onClick={addOption}
      >
        <Icon name="plus" className="size-3" />
        Add option
      </Button>
    </div>
  );
}
