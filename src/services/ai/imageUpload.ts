import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/services/firebase/app';

export const MAX_ATTACHMENTS = 3;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface StagedPhoto {
  id: string;
  localUri: string;
  dataUrl?: string;
  width: number;
  height: number;
}

export interface PickPhotoResult {
  photo?: StagedPhoto;
  cancelled?: boolean;
  friendlyError?: string;
}

function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('Could not read the selected photo.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

function isSupportedImage(asset: ImagePicker.ImagePickerAsset): boolean {
  if (asset.mimeType) {
    return ALLOWED_MIME_TYPES.has(asset.mimeType.toLowerCase());
  }
  const uriClean = asset.uri.split('?')[0].toLowerCase();
  const ext = uriClean.split('.').pop() || '';
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Resizes an image so its longest side is at most 1024px and compresses to JPEG.
 */
async function resizeAndCompressToJpeg(
  asset: ImagePicker.ImagePickerAsset
): Promise<ImageManipulator.ImageResult> {
  const { width, height, uri } = asset;
  const longestSide = Math.max(width || 0, height || 0);

  const actions: ImageManipulator.Action[] = [];
  if (longestSide > 1024) {
    if (width >= height) {
      actions.push({ resize: { width: 1024 } });
    } else {
      actions.push({ resize: { height: 1024 } });
    }
  }

  return ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.78,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
}

/**
 * Picks a photo from either the camera or photo library, validates format (JPEG, PNG, WebP)
 * and file size, then resizes to ~1024px on the longest side and compresses to JPEG.
 */
export async function pickAndPreparePhoto(
  source: 'camera' | 'gallery'
): Promise<PickPhotoResult> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        return {
          friendlyError: 'Please allow camera access in your phone settings to take a photo.',
        };
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        return {
          friendlyError: 'Please allow photo library access in your phone settings to attach a photo.',
        };
      }
    }

    const pickerFn =
      source === 'camera'
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;

    const result = await pickerFn({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { cancelled: true };
    }

    const asset = result.assets[0];

    if (!isSupportedImage(asset)) {
      return {
        friendlyError: 'Please choose a JPEG, PNG, or WebP photo.',
      };
    }

    if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE_BYTES * 2) {
      return {
        friendlyError: 'That photo is too large. Please choose a smaller photo.',
      };
    }

    const processed = await resizeAndCompressToJpeg(asset);

    // Compute compressed size from base64 when available to avoid React Native Blob overhead.
    let size = 0;
    if (processed.base64) {
      size = Math.floor((processed.base64.length * 3) / 4);
    } else {
      const blob = await uriToBlob(processed.uri);
      size = blob.size;
      const closeable = blob as Blob & { close?: () => void };
      closeable.close?.();
    }

    if (size > MAX_FILE_SIZE_BYTES) {
      return {
        friendlyError: 'That photo is still over 5 MB. Please choose a smaller photo.',
      };
    }

    return {
      photo: {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        localUri: processed.uri,
        dataUrl: processed.base64
          ? `data:image/jpeg;base64,${processed.base64}`
          : undefined,
        width: processed.width,
        height: processed.height,
      },
    };
  } catch {
    return {
      friendlyError: "We couldn't open that photo. You can try another one or continue with text.",
    };
  }
}

/**
 * Uploads staged JPEG photos to the patient's private Firebase Storage path
 * (`ai-intake/{patientId}/{sessionId}/...`) and returns their Storage paths.
 */
export async function uploadStagedPhotos(
  patientId: string,
  sessionId: string,
  photos: StagedPhoto[]
): Promise<{ paths: string[]; failedCount: number }> {
  const paths: string[] = [];
  let failedCount = 0;

  for (let i = 0; i < Math.min(photos.length, MAX_ATTACHMENTS); i++) {
    const photo = photos[i];
    const storagePath = `ai-intake/${patientId}/${sessionId}/${i}_${photo.id}.jpg`;
    const fileRef = ref(storage, storagePath);

    let blob: Blob | null = null;
    try {
      blob = await uriToBlob(photo.localUri);
      await uploadBytes(fileRef, blob, {
        contentType: 'image/jpeg',
      });
      paths.push(storagePath);
    } catch {
      failedCount++;
    } finally {
      if (blob) {
        const closeable = blob as Blob & { close?: () => void };
        closeable.close?.();
      }
    }
  }

  return { paths, failedCount };
}
