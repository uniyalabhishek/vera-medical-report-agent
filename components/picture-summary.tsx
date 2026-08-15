"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { Download, Image as ImageIcon, RotateCcw, X } from "lucide-react";
import type { Fact, Intake, ObservationFact } from "@/lib/contracts";
import { medicalReportApi } from "@/lib/client/api";
import { getMessages } from "@/lib/i18n";
import { selectVisualObservation } from "@/lib/visual-explanation";

const imageCache = new Map<string, string>();

function cacheImage(caseId: string, image: Blob) {
  const previous = imageCache.get(caseId);
  if (previous) URL.revokeObjectURL(previous);
  const imageUrl = URL.createObjectURL(image);
  imageCache.set(caseId, imageUrl);
  if (imageCache.size <= 3) return imageUrl;
  const oldest = imageCache.keys().next().value;
  if (oldest) {
    const evicted = imageCache.get(oldest);
    if (evicted) URL.revokeObjectURL(evicted);
    imageCache.delete(oldest);
  }
  return imageUrl;
}

function resultStatus(fact: ObservationFact, copy: ReturnType<typeof getMessages>) {
  if (fact.flag === "high") return copy.markedHigh;
  if (fact.flag === "low") return copy.markedLow;
  if (fact.flag === "normal") return copy.markedWithin;
  return copy.rangeNotClear;
}

export function PictureSummary({
  caseId,
  facts,
  language,
}: {
  caseId: string;
  facts: Fact[];
  language: Intake["language"];
}) {
  const copy = getMessages(language);
  const focus = useMemo(() => selectVisualObservation(facts), [facts]);
  const [imageUrl, setImageUrl] = useState<string | null>(() => imageCache.get(caseId) ?? null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    imageCache.has(caseId) ? "ready" : "idle",
  );
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!focus) return null;

  const generate = async () => {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const image = await medicalReportApi.createVisualExplanation(caseId);
      setImageUrl(cacheImage(caseId, image));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  const openPicture = () => {
    setOpen(true);
    if (status === "idle" || status === "error") void generate();
  };

  const dialog = open && typeof document !== "undefined"
    ? createPortal(
        <div className="picture-dialog-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            aria-busy={status === "loading"}
            aria-labelledby="picture-dialog-title"
            aria-modal="true"
            className="picture-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <header>
              <div>
                <h2 id="picture-dialog-title">{copy.pictureTitle}</h2>
                <p>{copy.pictureHelp}</p>
              </div>
              <button
                aria-label={copy.close}
                className="icon-button"
                onClick={() => setOpen(false)}
                ref={closeRef}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>

            {status === "loading" ? (
              <div className="picture-dialog__loading" role="status">
                <span className="spinner spinner--dark" aria-hidden="true" />
                <strong>{copy.picturePreparing}</strong>
                <p>{copy.pictureWait}</p>
              </div>
            ) : null}

            {status === "error" ? (
              <div className="picture-dialog__error" role="alert">
                <p>{copy.pictureError}</p>
                <button className="button" onClick={() => void generate()} type="button">
                  <RotateCcw aria-hidden="true" /> {copy.retry}
                </button>
              </div>
            ) : null}

            {status === "ready" && imageUrl ? (
              <>
                <Image
                  alt={`${copy.pictureAlt} ${focus.name}. ${copy.pictureHelp}`}
                  className="picture-dialog__image"
                  height={1024}
                  src={imageUrl}
                  unoptimized
                  width={1024}
                />
                <article className={`picture-dialog__fact picture-dialog__fact--${focus.flag}`}>
                  <div>
                    <span>{focus.name}</span>
                    <strong>{focus.value} {focus.unit}</strong>
                  </div>
                  <p>{resultStatus(focus, copy)}</p>
                  <small>
                    {focus.referenceRange
                      ? `${copy.printedRange}: ${focus.referenceRange} ${focus.unit}`
                      : copy.rangeNotClear}
                  </small>
                </article>
                <p className="picture-dialog__note">{copy.pictureNotScan}</p>
                <a
                  className="button button--primary button--wide"
                  download="vera-visual-explanation.jpg"
                  href={imageUrl}
                >
                  <Download aria-hidden="true" /> {copy.downloadPicture}
                </a>
              </>
            ) : null}
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <span className="picture-action-wrap">
        <button
          aria-label={status === "loading" ? copy.picturePreparing : copy.openPicture}
          className="picture-action"
          disabled={status === "loading"}
          onClick={openPicture}
          type="button"
        >
          {status === "loading"
            ? <span className="spinner spinner--dark" aria-hidden="true" />
            : <ImageIcon aria-hidden="true" />}
          <span>{status === "loading" ? copy.picturePreparing : copy.openPicture}</span>
        </button>
      </span>
      {dialog}
    </>
  );
}
