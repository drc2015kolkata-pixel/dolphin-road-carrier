export async function openCameraStreamWithFallback(): Promise<{
  stream: MediaStream;
  modeUsed: 'rear' | 'front' | 'default';
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not supported in this browser.');
  }

  const attempts: Array<{ mode: 'rear' | 'front' | 'default'; constraints: MediaStreamConstraints }> = [
    {
      mode: 'rear',
      constraints: {
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      },
    },
    {
      mode: 'front',
      constraints: {
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      },
    },
    {
      mode: 'default',
      constraints: {
        video: true,
        audio: false,
      },
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      return { stream, modeUsed: attempt.mode };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Unable to access any camera or USB webcam.');
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore already-stopped track errors
      }
    });
  } catch {
    // Ignore cleanup errors
  }
}

export function dataUrlToFile(dataUrl: string, fileName = `scan-${Date.now()}.jpg`): File {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
}
