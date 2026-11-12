import { openDB } from 'idb';
import { packProject, type Project } from '../core/model';

const database = openDB('zhijian', 1, {
  upgrade(db) {
    db.createObjectStore('documents', { keyPath: 'id' });
    db.createObjectStore('preferences');
  },
});
export async function saveDocument(project: Project): Promise<void> {
  const db = await database;
  const tx = db.transaction(['documents', 'preferences'], 'readwrite');
  await tx.objectStore('documents').put(packProject(project));
  await tx.objectStore('preferences').put(project.id, 'lastDocument');
  await tx.done;
}
export async function lastDocument(): Promise<unknown> {
  const db = await database;
  const key = await db.get('preferences', 'lastDocument');
  return key ? db.get('documents', key) : undefined;
}
export async function listDocuments(): Promise<Project[]> {
  return ((await (await database).getAll('documents')) as Project[]).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}
export async function deleteDocument(key: string): Promise<void> {
  const db = await database;
  const tx = db.transaction(['documents', 'preferences'], 'readwrite');
  await tx.objectStore('documents').delete(key);
  if ((await tx.objectStore('preferences').get('lastDocument')) === key)
    await tx.objectStore('preferences').delete('lastDocument');
  await tx.done;
}
