/** The name a sound gets when it leaves the board: its card title, with the file's extension. */
export function exportName(title: string | undefined, fileName: string) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot) : '';
  const clean = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 150);
  if (!clean) return fileName;
  return clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean : clean + ext;
}
