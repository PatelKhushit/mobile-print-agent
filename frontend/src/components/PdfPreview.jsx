import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const MAX_PREVIEW_PAGES = 3;
const THUMBNAIL_SCALE = 0.35; // low-res on purpose - this is a preview, not the print itself

/**
 * Renders the first few pages of an already-uploaded PDF as small canvas
 * thumbnails (spec section 15). Deliberately caps both the page count and
 * the render scale so a large document doesn't get pulled fully into
 * browser memory just to show "yes, this is the right file."
 */
export default function PdfPreview({ fileUrl, pageCount }) {
  const [thumbnails, setThumbnails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setThumbnails([]);
    setError('');
    setLoading(true);

    let loadingTask;
    async function render() {
      try {
        loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdf = await loadingTask.promise;
        const pagesToRender = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
        const images = [];

        for (let i = 1; i <= pagesToRender; i++) {
          if (cancelledRef.current) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          images.push(canvas.toDataURL('image/png'));
          page.cleanup();
        }

        if (!cancelledRef.current) setThumbnails(images);
        await pdf.destroy();
      } catch {
        if (!cancelledRef.current) setError('Preview unavailable for this document.');
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    }

    render();
    return () => {
      cancelledRef.current = true;
      if (loadingTask) loadingTask.destroy();
    };
  }, [fileUrl]);

  if (error) return null; // non-critical - filename/page count above already confirms the upload

  return (
    <div className="field pdf-preview">
      <span>Preview</span>
      {loading ? (
        <small>Rendering preview...</small>
      ) : (
        <div className="pdf-preview-strip">
          {thumbnails.map((src, i) => (
            <img key={i} src={src} alt={`Page ${i + 1}`} className="pdf-preview-thumb" />
          ))}
          {pageCount > MAX_PREVIEW_PAGES && (
            <div className="pdf-preview-more">+{pageCount - MAX_PREVIEW_PAGES} more</div>
          )}
        </div>
      )}
    </div>
  );
}
