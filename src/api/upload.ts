import { api, pid, unwrap } from './client';

type Purpose = 'guest_document' | 'maintenance_photo' | 'task_photo';
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;

/**
 * Загрузка файла по подписанной ссылке: API выдаёт ссылку, байты идут прямо в
 * хранилище. Тот же порядок будет и с S3, клиенту ничего менять не придётся.
 */
export async function uploadFile(file: File, purpose: Purpose): Promise<string> {
  const contentType = (ALLOWED as readonly string[]).includes(file.type) ? (file.type as (typeof ALLOWED)[number]) : null;
  if (!contentType) throw new Error('Можно загрузить фото (JPEG, PNG, WebP, HEIC) или PDF');
  if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ');
  const { fileId, upload } = await unwrap(
    api.POST('/api/v1/properties/{propertyId}/files', { params: { path: pid() }, body: { purpose, contentType, size: file.size } }),
  );
  const res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!res.ok) throw new Error('Не удалось загрузить файл');
  return fileId;
}
