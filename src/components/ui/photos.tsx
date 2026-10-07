import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, pid, unwrap } from '@/api/client';
import { uploadFile } from '@/api/upload';
import { CloseGlyph } from './overlay';

type Purpose = 'maintenance_photo' | 'task_photo';
type Item = { key: string; preview: string; fileId: string | null; failed: boolean };

/**
 * Фото к заявке или уборке. Снимок уходит в хранилище сразу после выбора,
 * форма отправляет только готовые fileId; пока что-то грузится, `busy`.
 */
export function usePhotos(purpose: Purpose, max = 10) {
  const [items, setItems] = useState<Item[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const add = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const room = Math.max(0, max - items.length);
      for (const file of Array.from(files).slice(0, room)) {
        const key = crypto.randomUUID();
        const preview = URL.createObjectURL(file);
        setItems((list) => [...list, { key, preview, fileId: null, failed: false }]);
        uploadFile(file, purpose).then(
          (fileId) => alive.current && setItems((list) => list.map((i) => (i.key === key ? { ...i, fileId } : i))),
          () => alive.current && setItems((list) => list.map((i) => (i.key === key ? { ...i, failed: true } : i))),
        );
      }
    },
    [items.length, max, purpose],
  );
  const remove = useCallback((key: string) => {
    setItems((list) => {
      const gone = list.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((i) => i.key !== key);
    });
  }, []);
  const reset = useCallback(() => {
    setItems((list) => {
      list.forEach((i) => URL.revokeObjectURL(i.preview));
      return [];
    });
  }, []);
  return {
    items,
    max,
    ids: items.flatMap((i) => (i.fileId ? [i.fileId] : [])),
    busy: items.some((i) => !i.fileId && !i.failed),
    add,
    remove,
    reset,
  };
}

export type Photos = ReturnType<typeof usePhotos>;

/** Кнопка «Добавить фото» и снимки, которые уже выбраны. Телефон предложит камеру или галерею. */
export function PhotoPicker({ photos, label = 'Добавить фото' }: { photos: Photos; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="photos">
      {photos.items.map((p) => (
        <div key={p.key} className="photo" data-state={p.failed ? 'failed' : p.fileId ? 'ready' : 'loading'}>
          <img src={p.preview} alt="" />
          {p.failed ? <span className="photo-note">не загрузилось</span> : !p.fileId ? <span className="photo-note">загружается</span> : null}
          <button type="button" className="photo-remove" aria-label="Убрать фото" onClick={() => photos.remove(p.key)}>
            <CloseGlyph />
          </button>
        </div>
      ))}
      {photos.items.length < photos.max ? (
        <>
          <button type="button" className="btn btn-ghost photo-add" onClick={() => input.current?.click()}>
            {label}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              photos.add(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** Уже сохранённые фото: ссылка на каждое живёт несколько минут, поэтому берётся по месту. */
export function PhotoStrip({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="photos">
      {ids.map((id) => (
        <StoredPhoto key={id} id={id} />
      ))}
    </div>
  );
}

function StoredPhoto({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['file', id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/files/{id}/url', { params: { path: { ...pid(), id } } })),
    staleTime: 4 * 60_000,
  });
  if (!q.data) return <span className="photo" data-state="loading" aria-busy="true" />;
  return (
    <a className="photo" href={q.data.url} target="_blank" rel="noreferrer" aria-label="Открыть фото">
      <img src={q.data.url} alt="" loading="lazy" />
    </a>
  );
}
