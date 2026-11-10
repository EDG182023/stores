import { supabase } from './supabase.js';

const BUCKET = 'product-images';

/** Achica la imagen en el navegador (máx. 1280px, JPEG) para subir rápido y gastar menos */
export function resizeImage(file, max = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato de imagen no soportado')); };
    img.src = url;
  });
}

/** Sube una foto al Storage del negocio y devuelve su URL pública */
export async function uploadImage(businessId, file, prefix = 'img') {
  const blob = await resizeImage(file);
  const path = `${businessId}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) {
    if (/bucket/i.test(error.message)) throw new Error('Falta crear el almacenamiento de fotos: corré migration_002 en Supabase.');
    throw new Error('No se pudo subir la foto: ' + error.message);
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
